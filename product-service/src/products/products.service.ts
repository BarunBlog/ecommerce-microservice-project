import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import slugify from 'slugify';

import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  CategoryEmbed,
  SerializedProduct,
  serializeProduct,
} from './entities/product.entity';

const PRODUCTS_EXCHANGE = 'ecommerce.events';
const ROUTING_KEY_PRODUCT_CREATED = 'products.event.created';

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
 *   5. Async event emission: on create(), publish a
 *      `products.event.created` message to the platform's RabbitMQ
 *      topic exchange.
 */
@Injectable()
export class ProductsService implements OnModuleInit {
  private readonly logger = new Logger(ProductsService.name);
  private readonly categoryBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @Inject('EVENTS_BUS') private readonly eventsBus: ClientProxy,
  ) {
    this.categoryBaseUrl = (
      this.config.get<string>('CATEGORY_SERVICE_BASE_URL') ??
      'http://category-service:8000'
    ).replace(/\/+$/, '');
  }

  /**
   * Make sure the platform's topic exchange exists before we ever try
   * to publish to it. emit() is otherwise lazy and would silently
   * buffer in a disconnected ClientProxy.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.eventsBus.connect();
      this.logger.log('EVENTS_BUS connected to RabbitMQ');
    } catch (err) {
      this.logger.error(
        `EVENTS_BUS failed to connect to RabbitMQ: ${(err as Error).message}`,
      );
      // Re-throw so the container restart loop catches it loudly.
      throw err;
    }
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
    this.emitProductCreated(product).catch((err) => {
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
    await this.prisma.product.delete({ where: { id } });
  }

  // ---------------------------------------------------------- internals
  private buildSlug(name: string): string {
    return slugify(name, { lower: true, strict: true, trim: true }).slice(0, 120);
  }

  /**
   * Embed a category block by calling category-service. Network errors
   * are swallowed (logged) and surfaced as `null` so the product row
   * remains the authoritative response payload.
   */
  private async fetchCategory(categoryId: string): Promise<CategoryEmbed | null> {
    const url = `${this.categoryBaseUrl}/api/categories/${categoryId}/`;
    try {
      const res = await firstValueFrom(
        this.http.get<CategoryEmbed>(url, { timeout: 3_000 }),
      );
      return res.data ?? null;
    } catch (err) {
      this.logger.warn(
        `category-service lookup failed for ${categoryId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async emitProductCreated(product: SerializedProduct): Promise<void> {
    await firstValueFrom(
      this.eventsBus.emit(ROUTING_KEY_PRODUCT_CREATED, {
        event: ROUTING_KEY_PRODUCT_CREATED,
        occurredAt: new Date().toISOString(),
        data: product,
      }),
    );
    this.logger.log(
      `Published ${ROUTING_KEY_PRODUCT_CREATED} for product ${product.id} to ${PRODUCTS_EXCHANGE}`,
    );
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