import { IsInt, IsUUID } from 'class-validator';

/**
 * Payload accepted by POST /api/inventory/adjust.
 *
 * `quantity` is signed:
 *   - positive  -> increment warehouse stock (e.g. a new shipment arrived)
 *   - negative  -> decrement warehouse stock (e.g. write-off / shrinkage)
 *
 * The route is intentionally separate from any future reservations
 * endpoint: this is the warehouse-level adjust only. Reservation
 * lifecycle lives behind a different DTO once cart/order services
 * come online (AGENTS.md §8 lists them as not-started).
 */
export class AdjustInventoryDto {
  @IsUUID('4')
  productId!: string;

  @IsInt()
  quantity!: number;
}