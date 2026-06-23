import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Payload accepted by POST /api/products/.
 *
 * The client never sends `id`, `slug`, `createdAt`, or `updatedAt` — those
 * are server-generated. We forbid unknown fields at the ValidationPipe
 * level (see main.ts `forbidNonWhitelisted`), so a client attempting to
 * set `slug` gets a 400 rather than silent drop.
 *
 * `price` arrives as a string in JSON (avoid floating-point drift on the
 * wire) and is validated as a decimal with two fractional digits.
 */
export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 64)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'sku must be alphanumeric (._- allowed)',
  })
  sku!: string;

  @IsUUID('4')
  categoryId!: string;

  // Decimal(10,2) on the Prisma side. We coerce to string to preserve
  // precision, then enforce a strict two-decimal regex.
  @IsString()
  @Matches(/^\d{1,8}\.\d{2}$/, {
    message: 'price must match /^[0-9]{1,8}\\.[0-9]{2}$/ (e.g. "19.99")',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'number' ? value.toFixed(2) : value,
  )
  price!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;
}