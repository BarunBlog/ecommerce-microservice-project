import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import slugify from 'slugify';

import { PrismaService } from '../prisma/prisma.service';
import { RabbitMqPublisher } from '../events/rabbitmq.publisher';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  CategoryEmbed,
  SerializedProduct,
  serializeProduct,
} from './entities/product.entity';

export type ProductEvent = 'created' | 'updated' | 'deleted';

/**
 * Payload shape for `products.event.deleted`. It is the serialized
 * product snapshot (the row as it stood at delete time) plus a
 * `hard` discriminator so consumers can distinguish soft from hard
 * deletes without re-deriving it. For `created`/`updated` we use the
 * plain `SerializedProduct` (no extra flag).
 */
export type ProductEventPayload = SerializedProduct | (SerializedProduct & { hard: boolean });

interface ListOptions {
  includeInactive: boolean;
}

/**
 * Service layer for products.
 *
 * Responsibilities:
 *   1. CRUD on the `products` table via Prisma (own DB, no joins).
 *   2. Slug generation from `name` (server wins on slug, same as
 *      category-service).
 *   3. Soft-delete handling. Hard delete is explicit and rare.
 *   4. Cross-service sync read: on findOne(), fetch the related
 *      category from category-service over HTTP and embed it.
 *   5. Async event emission: on create/update/delete (soft & hard),
 *      publish a `products.event.<event>` message to the platform's
 *      RabbitMQ topic exchange via a single generic emit() helper.
 */
@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);
  private readonly categoryBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly eventsBus: RabbitMqPublisher,
  ) {
    this.categoryBaseUrl = (
      this.config.get<string>('CATEGORY_SERVICE_BASE_URL') ??
      'http://category-service:8000'
    ).replace(/\/+$/, '');
  }

  // ---------------------------------------------------------------- create
  async create(dto: CreateProductDto): Promise<SerializedProduct> {
    const slug = this.buildSlug(dto.name);

    let product: SerializedProduct;
    try {
      const created = await this.prisma.product.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description ?? null,
          // Prisma accepts the validated string for Decimal columns and
          // normalizes to Decimal(10,2) on the server side.
          price: new Prisma.Decimal(dto.price),
          sku: dto.sku,
          categoryId: dto.categoryId,
          isActive: dto.isActive ?? true,
        },
      });
      product = serializeProduct(created);
    } catch (err) {
      throw this.translatePrismaError(err);
    }

    // Publish event AFTER the row is committed. A best-effort emit —
    // we log a warning on failure but do not roll back the row. The
    // events bus is fire-and-forget; consumers are expected to be
    // idempotent and the broker is durable.
    this.emitProductEvent('created', product).catch((err) => {
      this.logger.warn(
        `Failed to publish products.event.created for ${product.id}: ${err}`,
      );
    });

    return product;
  }

  // ------------------------------------------------------------------ list
  async findAll(opts: ListOptions): Promise<SerializedProduct[]> {
    const rows = await this.prisma.product.findMany({
      where: opts.includeInactive ? {} : { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(serializeProduct);
  }

  // ---------------------------------------------------------------- findOne
  /**
   * Returns a single product with its category metadata embedded.
   * The category fetch is over HTTP to category-service; on failure
   * (4xx/5xx/timeout) we embed `category: null` and continue — the
   * product itself is still the source of truth and we do not want a
   * transient category-service outage to mask a successful product
   * lookup. Network errors are logged at warn.
   */
  async findOne(id: string): Promise<SerializedProduct> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    const product = serializeProduct(row);
    product.category = await this.fetchCategory(row.categoryId);
    return product;
  }

  // ---------------------------------------------------------------- update
  async update(id: string, dto: UpdateProductDto): Promise<SerializedProduct> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    // Rebuild slug whenever the name changes. Mirrors the
    // category-service rule: server wins on slug, clients never set it.
    const data: Prisma.ProductUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
      data.slug = this.buildSlug(dto.name);
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.price !== undefined) {
      data.price = new Prisma.Decimal(dto.price);
    }
    if (dto.sku !== undefined) data.sku = dto.sku;
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    let updated: SerializedProduct;
    try {
      const row = await this.prisma.product.update({ where: { id }, data });
      updated = serializeProduct(row);
    } catch (err) {
      throw this.translatePrismaError(err);
    }

    // Best-effort event publish — same contract as create(): warn on
    // failure, never roll back the write.
    this.emitProductEvent('updated', updated).catch((err) => {
      this.logger.warn(
        `Failed to publish products.event.updated for ${updated.id}: ${err}`,
      );
    });

    return updated;
  }

  // --------------------------------------------------------------- remove
  /**
   * Soft-delete by default. `?hard=true` performs a real row deletion.
   * Returns the body shape per AGENTS.md §3.7: HTTP 200 + body for
   * soft-delete, HTTP 204 for hard delete. The controller maps the
   * 204 path itself; this method returns the body for the soft path.
   */
  async softRemove(id: string): Promise<{ detail: string; id: string }> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    if (!existing.isActive) {
      return {
        detail: 'Product already soft-deleted (isActive=false).',
        id,
      };
    }
    const updated = await this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    // Best-effort event publish. We send the serialized row as it
    // stands post-mutation (isActive=false) plus a `hard: false`
    // discriminator so consumers can tell soft vs hard deletes apart.
    this.emitProductEvent('deleted', { ...serializeProduct(updated), hard: false }).catch(
      (err) => {
        this.logger.warn(
          `Failed to publish products.event.deleted (soft) for ${updated.id}: ${err}`,
        );
      },
    );

    return {
      detail: 'Product soft-deleted (isActive=false).',
      id: updated.id,
    };
  }

  async hardRemove(id: string): Promise<void> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    // Snapshot before delete — the row will be gone after this call.
    const snapshot = serializeProduct(existing);
    await this.prisma.product.delete({ where: { id } });

    // Best-effort event publish. The row no longer exists locally,
    // so we attach the last known snapshot plus `hard: true` so
    // consumers can route/delete/replay accordingly.
    this.emitProductEvent('deleted', { ...snapshot, hard: true }).catch((err) => {
      this.logger.warn(
        `Failed to publish products.event.deleted (hard) for ${snapshot.id}: ${err}`,
      );
    });
  }

  // ---------------------------------------------------------- internals
  private buildSlug(name: string): string {
    return slugify(name, { lower: true, strict: true, trim: true }).slice(
      0,
      120,
    );
  }

  /**
   * Embed a category block by calling category-service. Network errors
   * are swallowed (logged) and surfaced as `null` so the product row
   * remains the authoritative response payload.
   */
  private async fetchCategory(categoryId: string): Promise<CategoryEmbed | null> {
    const url = `${this.categoryBaseUrl}/api/categories/${categoryId}/`;
    try {
      const res = await this.http.axiosRef.get<CategoryEmbed>(url, {
        timeout: 3_000,
      });
      return res.data ?? null;
    } catch (err) {
      this.logger.warn(
        `category-service lookup failed for ${categoryId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Generic event publisher. All product lifecycle events flow through
   * here so we never end up with a parallel `emitProductCreated` /
   * `emitProductUpdated` / `emitProductDeleted` per-action method.
   *
   * Routing key is derived as `products.event.<event>`. The payload
   * shape is:
   *   { event, occurredAt, data: <payload> }
   * where `data` is whatever the caller passed (the serialized product
   * for created/updated, the snapshot+`hard` flag for deleted).
   */
  private async emitProductEvent(
    event: ProductEvent,
    payload: ProductEventPayload,
  ): Promise<void> {
    const routingKey = `products.event.${event}`;
    await this.eventsBus.publish(routingKey, {
      event: routingKey,
      occurredAt: new Date().toISOString(),
      data: payload,
    });
    this.logger.log(`Published ${routingKey} for product ${payload.id}`);
  }

  /**
   * Translate Prisma's known error codes into Nest HTTP exceptions so
   * the controller layer doesn't have to know about Prisma. Anything
   * not on the allowlist becomes a 500 — it almost always means a bug
   * or a DB outage and we want a stack trace in the logs.
   */
  private translatePrismaError(err: unknown): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002: unique constraint violation. We surface the field that
      // collided so the client can correct their input.
      if (err.code === 'P2002') {
        const target = Array.isArray(err.meta?.target)
          ? (err.meta?.target as string[]).join(', ')
          : String(err.meta?.target ?? 'field');
        return new BadRequestException(
          `A product with this ${target} already exists.`,
        );
      }
      // P2025: record not found (shouldn't happen on create, but be safe).
      if (err.code === 'P2025') {
        return new NotFoundException('Referenced record not found.');
      }
    }
    return err as Error;
  }
}