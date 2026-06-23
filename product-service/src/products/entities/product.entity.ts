import { Product } from '@prisma/client';

/**
 * Shape returned to API clients. We don't expose the Prisma row directly
 * — the service layer wraps each Product with a `category` block fetched
 * from category-service. The base shape is the Prisma row, serialized
 * (Decimal → string, Date → ISO string) to keep responses JSON-clean.
 */
export interface SerializedProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  sku: string;
  categoryId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  category: CategoryEmbed | null;
}

export interface CategoryEmbed {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isActive?: boolean;
}

/**
 * Convert a Prisma `Product` row into the JSON shape we want to ship.
 * Prisma gives Decimal as a Decimal.js instance; JSON.stringify doesn't
 * know how to render it, so we coerce to a plain string here.
 */
export function serializeProduct(product: Product): SerializedProduct {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price: product.price.toString(),
    sku: product.sku,
    categoryId: product.categoryId,
    isActive: product.isActive,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    category: null,
  };
}