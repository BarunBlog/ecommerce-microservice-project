import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { InventoryService, StockUnderflowException } from './inventory.service';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { SerializedInventory } from './entities/inventory.entity';

/**
 * /api/inventory — REST controller (HTTP-only).
 *
 * RabbitMQ event consumption lives in `inventory.consumer.ts` so this
 * file stays focused on the REST surface. Both files are registered
 * as controllers in InventoryModule and share the same Nest DI graph,
 * so the consumer can inject InventoryService directly.
 *
 * Conventions (mirrored from category-service / product-service per
 * AGENTS.md):
 *   - /api prefix is applied globally in main.ts.
 *   - UUIDs are validated with ParseUUIDPipe v4 before reaching the
 *     service.
 *   - Trailing slash is NOT used; Nest does not 301-redirect, so
 *     `/api/inventory/<uuid>` is the canonical form. README has the
 *     full URL table.
 */
@Controller('inventory')
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(private readonly inventory: InventoryService) {}

  // ------------------------------------------------------------- HTTP

  /**
   * GET /api/inventory/:productId — current stock status.
   * Returns 404 if no row has been provisioned for this product yet.
   */
  @Get(':productId')
  async getByProductId(
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
  ): Promise<SerializedInventory> {
    return this.inventory.getByProductId(productId);
  }

  /**
   * POST /api/inventory/adjust — signed warehouse stock adjustment.
   *   - quantity > 0 : increment (incoming shipment, returns from customer)
   *   - quantity < 0 : decrement (write-off, shrinkage)
   *   - quantity = 0 : no-op; 400 because it's almost certainly a client bug
   */
  @Post('adjust')
  async adjust(@Body() dto: AdjustInventoryDto): Promise<SerializedInventory> {
    if (dto.quantity === 0) {
      throw new BadRequestException('quantity must be non-zero');
    }
    try {
      return await this.inventory.adjust(dto);
    } catch (err) {
      if (err instanceof StockUnderflowException) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}