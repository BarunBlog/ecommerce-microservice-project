import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import {
  ProductCreatedEvent,
  ProductDeletedEvent,
  ProductUpdatedEvent,
  SerializedInventory,
  serializeInventory,
} from './entities/inventory.entity';

/**
 * Service layer for inventory.
 *
 * Responsibilities:
 *   1. CRUD on the `inventories` table via Prisma (own DB, no joins).
 *   2. React to `products.event.created` events from product-service
 *      and idempotently provision an Inventory row with stockCount=0.
 *   3. Apply signed stock adjustments. Reservation lifecycle is
 *      intentionally out of scope for now.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------------- read
  /**
   * Look up the inventory row for a product. Throws 404 if the row
   * does not exist — callers should treat that as "this product has
   * not been provisioned yet" and respond accordingly. We deliberately
   * do not auto-provision on read: the only path that creates a row
   * is the RMQ consumer (or an explicit admin call). Auto-provisioning
   * on read would let a bad productId silently turn into a fresh
   * empty inventory row.
   */
  async getByProductId(productId: string): Promise<SerializedInventory> {
    const row = await this.prisma.inventory.findUnique({
      where: { productId },
    });
    if (!row) {
      throw new NotFoundException(
        `No inventory record exists for product ${productId}`,
      );
    }
    return serializeInventory(row);
  }

  // -------------------------------------------------------------- adjust
  /**
   * Apply a signed adjustment to stockCount.
   *
   * Refuses to drive stockCount below 0 — that is a real-world bug
   * (overselling, double write-off) and we want it surfaced as a
   * 400, not silently absorbed.
   *
   * `reservedCount` is left alone: a stock adjust is a warehouse
   * operation (incoming shipment, write-off, manual correction),
   * not a reservation movement.
   */
  async adjust(dto: AdjustInventoryDto): Promise<SerializedInventory> {
    const existing = await this.prisma.inventory.findUnique({
      where: { productId: dto.productId },
    });
    if (!existing) {
      throw new NotFoundException(
        `No inventory record exists for product ${dto.productId}`,
      );
    }

    const next = existing.stockCount + dto.quantity;
    if (next < 0) {
      throw new StockUnderflowException(
        `Adjustment of ${dto.quantity} would drive stockCount below 0 (current=${existing.stockCount})`,
      );
    }

    const updated = await this.prisma.inventory.update({
      where: { productId: dto.productId },
      data: { stockCount: next },
    });
    return serializeInventory(updated);
  }

  // --------------------------------------------------- event consumption
  /**
   * Idempotently provision an inventory row for a newly-created
   * product. Called by the @EventPattern handler in
   * inventory.consumer.ts when a `products.event.created` message
   * arrives.
   *
   * Idempotency contract: if a row already exists for the productId
   * (e.g. a duplicate event from the broker, or a manual insert), we
   * keep the existing stockCount and do not reset it to 0. The
   * `@unique` on productId makes the underlying upsert race-safe.
   */
  async provisionForProduct(productId: string): Promise<SerializedInventory> {
    const row = await this.prisma.inventory.upsert({
      where: { productId },
      create: { productId, stockCount: 0 },
      // On conflict, do nothing — preserve whatever stock already exists.
      update: {},
    });
    return serializeInventory(row);
  }

  /**
   * Validate a `products.event.created` payload, then provision.
   * Returns the provisioned row, or `null` if the payload was invalid
   * (we ack-invalid and log rather than requeue forever).
   */
  async handleProductCreated(
    payload: ProductCreatedEvent | unknown,
  ): Promise<SerializedInventory | null> {
    const productId = this.extractProductId(payload);
    if (!productId) {
      throw new NonRecoverableEventError(
        `Ignoring products.event.created: missing or invalid data.id (payload=${JSON.stringify(payload)})`,
      );
    }
    const row = await this.provisionForProduct(productId);
    this.logger.log(
      `Provisioned inventory for product ${productId} (id=${row.id}, stockCount=${row.stockCount})`,
    );
    return row;
  }

  /**
   * Validate a `products.event.updated` payload. Today this is a
   * no-op acknowledgement: the inventory row already exists (because
   * `created` runs first and provisions it), and a name/price/category
   * change does not affect stock counts. A future feature — e.g.
   * syncing the default `location` from product metadata, or bumping
   * `reservedCount` on a sales-channel switch — can hook in here
   * without changing the consumer contract.
   *
   * Returns the productId for log correlation, or `null` if the
   * payload was malformed (consumer drops without requeue).
   */
  async handleProductUpdated(
    payload: ProductUpdatedEvent | unknown,
  ): Promise<string | null> {
    const productId = this.extractProductId(payload);
    if (!productId) {
      throw new NonRecoverableEventError(
        `Ignoring products.event.updated: missing or invalid data.id (payload=${JSON.stringify(payload)})`,
      );
    }
    // Touch the row to confirm it exists. We do NOT update stock or
    // location here — updated events are for product metadata.
    const existing = await this.prisma.inventory.findUnique({
      where: { productId },
      select: { id: true },
    });
    if (!existing) {
      // An `updated` arriving without a prior `created` is a
      // publish-order race or a missed message. We log loudly but
      // do NOT auto-provision here: that would let a malformed
      // event create rows for unknown products. Operators can
      // reconcile by replaying the missing `created`.
      this.logger.warn(
        `[products.event.updated] no inventory row found for productId=${productId}; create event was likely missed`,
      );
    }
    return productId;
  }

  /**
   * Apply a `products.event.deleted` payload.
   *
   * Returns:
   *   - 'deleted' : hard-delete observed, inventory row removed.
   *   - 'kept'    : soft-delete observed, inventory row retained.
   *   - 'absent'  : no inventory row existed (never provisioned).
   *   - `null`    : payload was malformed (consumer drops).
   *
   * Soft-delete policy: we deliberately keep the inventory row.
   * Soft-deleted products still occupy a stock slot until hard-deleted
   * (audit trail + reconciliation use cases). Clearing inventory
   * here would lose the history of stock the product ever carried.
   *
   * Hard-delete policy: delete the matching inventory row. The
   * product row no longer exists in product-service, so a dangling
   * inventory row would be unreachable from any UI and is dead weight.
   */
  async handleProductDeleted(
    payload: ProductDeletedEvent | unknown,
  ): Promise<'deleted' | 'kept' | 'absent' | null> {
    const productId = this.extractProductId(payload);
    if (!productId) {
      throw new NonRecoverableEventError(
        `Ignoring products.event.deleted: missing or invalid data.id (payload=${JSON.stringify(payload)})`,
      );
    }

    const isHard = this.extractHardFlag(payload);

    // Idempotency: a redelivered hard-delete hitting a row that is
    // already gone should not raise — `delete` returns null when no
    // row matches, which we map to 'absent' so the consumer can log
    // it consistently.
    const existing = await this.prisma.inventory.findUnique({
      where: { productId },
      select: { id: true },
    });
    if (!existing) {
      return 'absent';
    }

    if (isHard) {
      await this.prisma.inventory.delete({ where: { productId } });
      return 'deleted';
    }
    return 'kept';
  }

  // -------------------------------------------------------------- helpers
  private extractProductId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Partial<ProductCreatedEvent>;
    const id = p.data?.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    // Cheap shape check. We don't import class-validator here because
    // RMQ payloads bypass the global ValidationPipe — the consumer
    // is the trust boundary, and we want a single defensible default
    // (log + drop) rather than a 400.
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidV4.test(id) ? id : null;
  }

  /**
   * Read the optional `data.hard` discriminator from a deleted event.
   * Defaults to `false` (soft-delete) so an older producer that omits
   * the flag does not accidentally hard-clear inventory rows.
   */
  private extractHardFlag(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const p = payload as { data?: { hard?: unknown } };
    return p.data?.hard === true;
  }
}

/**
 * Thrown when an adjust would drive stockCount below 0. A regular
 * BadRequestException would also work, but a typed error keeps the
 * service readable and lets the controller map it to whatever status
 * code is most useful without re-throwing.
 */
export class StockUnderflowException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockUnderflowException';
  }
}

/**
 * Marker error for "this message will never succeed — drop it".
 *
 * The consumer checks `err.nonRecoverable` and nack-without-requeue
 * so a poison message (bad UUID, malformed envelope) does not block
 * the queue forever. Transient errors (DB outage, network) are
 * re-thrown as plain Errors so the consumer nack-with-requeue.
 */
export class NonRecoverableEventError extends Error {
  readonly nonRecoverable = true;
  constructor(message: string) {
    super(message);
    this.name = 'NonRecoverableEventError';
  }
}

// Re-export Prisma error type so the controller can map it without
// reaching into @prisma/client directly.
export type PrismaKnownError = Prisma.PrismaClientKnownRequestError;