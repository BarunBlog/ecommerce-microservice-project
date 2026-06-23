import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';

import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';
import { SerializedProduct } from './entities/product.entity';

/**
 * /api/products — REST controller.
 *
 * Conventions (mirrored from category-service per AGENTS.md):
 *   - The /api prefix is applied globally in main.ts
 *     (`app.setGlobalPrefix('api')`); this controller only declares the
 *     `products` segment.
 *   - Routes are written WITHOUT trailing slashes (`@Get()`,
 *     `@Get(':id')`, `@Post()`). Unlike Django, Nest/Express does NOT
 *     301-redirect a missing trailing slash, so URLs are
 *     `/api/products` and `/api/products/<uuid>` — not `/api/products/`.
 *   - GET endpoints default to active-only; ?all=true opts in.
 *   - DELETE is soft by default; ?hard=true performs a real delete.
 */
@Controller({ path: 'products', version: undefined })
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /**
   * POST /api/products — create a product.
   * Slug is auto-generated server-side from `name`. On success, a
   * `products.event.created` event is published asynchronously.
   */
  @Post()
  async create(@Body() dto: CreateProductDto): Promise<SerializedProduct> {
    return this.products.create(dto);
  }

  /**
   * GET /api/products — list products.
   * @query all  - "true" to include soft-deleted (isActive=false) rows.
   */
  @Get()
  async findAll(@Query('all') all?: string): Promise<SerializedProduct[]> {
    return this.products.findAll({ includeInactive: this.parseBool(all) });
  }

  /**
   * GET /api/products/:id — retrieve a product with category embedded.
   * The UUID is validated by ParseUUIDPipe (v4) before the service runs.
   */
  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<SerializedProduct> {
    return this.products.findOne(id);
  }

  /**
   * PATCH /api/products/:id — partial update.
   * If `name` is provided, the slug is regenerated automatically.
   */
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<SerializedProduct> {
    return this.products.update(id, dto);
  }

  /**
   * DELETE /api/products/:id — soft-delete by default.
   * @query hard - "true" to perform a real row delete (returns 204).
   *              Otherwise the row is soft-deleted and 200 + body returned.
   */
  @Delete(':id')
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('hard') hard: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ detail: string; id: string } | void> {
    if (this.parseBool(hard)) {
      await this.products.hardRemove(id);
      res.status(HttpStatus.NO_CONTENT);
      return;
    }
    return this.products.softRemove(id);
  }

  // ----- helpers ---------------------------------------------------------
  private parseBool(v: string | undefined): boolean {
    return (v ?? '').toLowerCase() === 'true';
  }
}