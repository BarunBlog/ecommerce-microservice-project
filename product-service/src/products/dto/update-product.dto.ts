import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsUUID } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

/**
 * Payload accepted by PATCH /api/products/:id/.
 *
 * All fields optional. If `name` changes, the service regenerates the
 * slug (server wins on slug, same convention as category-service).
 * `categoryId` may be reassigned to another category that lives in
 * category-service; we do not validate the existence of that category
 * here — the next GET through findOne() will surface a 404 from the
 * category-service and the embed will be null.
 */
export class UpdateProductDto extends PartialType(CreateProductDto) {
  // Override categoryId with an explicit IsOptional since PartialType
  // already makes every field optional — keeping this here documents the
  // intent: you may move a product to a different category.
  @IsOptional()
  @IsUUID('4')
  declare categoryId?: string;
}