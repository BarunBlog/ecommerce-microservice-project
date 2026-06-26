import { Inventory } from '@prisma/client';

/**
 * Shape returned to API clients for /api/inventory/:productId.
 *
 * `available` is a derived field: `stockCount - reservedCount`. It is
 * never persisted — it is computed at serialization time so that a
 * bug elsewhere cannot leave a stale value in the DB.
 */
export interface SerializedInventory {
  id: string;
  productId: string;
  stockCount: number;
  reservedCount: number;
  available: number;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

export function serializeInventory(row: Inventory): SerializedInventory {
  return {
    id: row.id,
    productId: row.productId,
    stockCount: row.stockCount,
    reservedCount: row.reservedCount,
    available: row.stockCount - row.reservedCount,
    location: row.location,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Wire shape of every products.event.* message published by
 * product-service. The envelope is identical across all three events:
 *
 *   {
 *     event:     "products.event.created" | "products.event.updated" | "products.event.deleted",
 *     occurredAt:"2026-06-26T...",
 *     data:      <SerializedProduct | SerializedProduct & { hard: boolean }>
 *   }
 *
 * product-service emits the full SerializedProduct snapshot under
 * `data` (see product-service src/products/products.service.ts
 * emitProductEvent). We only need `data.id` for our provisioning
 * flow, but the type is permissive about the rest so the consumer
 * does not break when product-service adds new fields.
 *
 * The three aliases below let each @EventPattern handler in
 * inventory.consumer.ts be typed honestly even though the runtime
 * envelope is the same.
 */
interface ProductEventEnvelope<T> {
  event: string;
  occurredAt: string;
  data: T;
}

interface ProductSnapshot {
  id: string;
  [k: string]: unknown;
}

export interface ProductCreatedEvent
  extends ProductEventEnvelope<ProductSnapshot> {}

export interface ProductUpdatedEvent
  extends ProductEventEnvelope<ProductSnapshot> {}

/**
 * product-service attaches `hard: boolean` to deleted events so
 * consumers can distinguish soft (isActive=false) from hard (real row
 * delete). The default is `false` for backward compatibility with
 * any future producer that omits the flag.
 */
export interface ProductDeletedEvent
  extends ProductEventEnvelope<ProductSnapshot & { hard?: boolean }> {}