# product-service

Headless NestJS microservice that owns the **Product catalog and pricing**
for the ecommerce platform. Speaks JSON, persists to its own PostgreSQL
via Prisma, embeds category metadata from `category-service` over HTTP,
and publishes lifecycle events to the platform's RabbitMQ topic exchange.

## Stack

- **Language/framework:** TypeScript + NestJS 10 (strict mode)
- **Database / ORM:** PostgreSQL 16 + Prisma 5
- **HTTP cross-service:** `@nestjs/axios`
- **Async messaging:** `@nestjs/microservices` (RabbitMQ topic exchange)
- **Validation:** `class-validator` + `class-transformer`

## Scope (and what it does NOT own)

- Owns `Product` records (name, slug, description, price, SKU, isActive).
- References categories by `categoryId` UUID string — no DB-level FK.
- Does **not** track stock counts (owned by `inventory-service`).
- Does **not** own category data (owned by `category-service`).

## Endpoints

All under `/api/products/`:

| Method | Path        | Purpose |
|--------|-------------|---------|
| POST   | `/`         | Create a product. Slug is auto-generated from `name`. Publishes `products.event.created` to RabbitMQ. |
| GET    | `/`         | List products, active only by default. `?all=true` to include inactive. |
| GET    | `/:id/`     | Retrieve a product. Embeds `category` block fetched from category-service. |
| PATCH  | `/:id/`     | Partial update. Slug is regenerated if `name` changes. |
| DELETE | `/:id/`     | Soft-delete (`isActive=false`) by default. `?hard=true` performs a real row delete (returns 204). |
| GET    | `/healthz`  | `{"status":"ok","service":"product-service"}`. No auth. |

### Request body (POST)

```json
{
  "name": "Mechanical Keyboard",
  "sku": "KB-MX-001",
  "categoryId": "8b7a6c1e-3c2b-4d3a-9c0e-1f2a3b4c5d6e",
  "price": "129.99",
  "description": "Hot-swappable switches, RGB underglow.",
  "isActive": true
}
```

`slug`, `id`, `createdAt`, `updatedAt` are server-generated and will be
rejected (HTTP 400) if supplied by the client.

### Response shape (GET /:id/)

```json
{
  "id": "f1c2...",
  "name": "Mechanical Keyboard",
  "slug": "mechanical-keyboard",
  "description": "Hot-swappable switches, RGB underglow.",
  "price": "129.99",
  "sku": "KB-MX-001",
  "categoryId": "8b7a...",
  "isActive": true,
  "createdAt": "2026-06-23T10:00:00.000Z",
  "updatedAt": "2026-06-23T10:00:00.000Z",
  "category": {
    "id": "8b7a...",
    "name": "Electronics",
    "slug": "electronics",
    "isActive": true
  }
}
```

The `category` block is fetched synchronously from
`http://category-service:8000/api/categories/<categoryId>/`. If that call
fails (timeout, 4xx, 5xx) the product is still returned with
`"category": null` and a warning is logged. Stock counts are intentionally
absent — `inventory-service` is the source of truth for that.

## RabbitMQ events

| Routing key                | Exchange          | When published                  | Payload |
|----------------------------|-------------------|---------------------------------|---------|
| `products.event.created`   | `ecommerce.events`| After `POST /api/products/` succeeds | `{ event, occurredAt, data: <product> }` |

The exchange is declared as `topic` + `durable`. Other services should
declare their own queues and bind them to `ecommerce.events` with the
routing keys they care about. This service is producer-only — it does
not declare a consumer queue.

## Environment variables

See `.env.example`. Notable keys:

| Var                          | Default                                      | Notes |
|------------------------------|----------------------------------------------|-------|
| `PORT`                       | `8001`                                       | Nest HTTP port |
| `DATABASE_URL`               | `postgresql://product_user:...@product-db:5432/product_db` | Prisma DSN |
| `CATEGORY_SERVICE_BASE_URL`  | `http://category-service:8000`               | Used for cross-service category fetch |
| `RABBITMQ_URL`               | `amqp://guest:guest@rabbitmq:5672`           | AMQP URI |
| `RABBITMQ_EXCHANGE`          | `ecommerce.events`                           | Topic exchange name |

## Local run (without Docker)

```bash
cp .env.example .env
# In .env:
#   - keep POSTGRES_PASSWORD at the dev default, or set your own
#   - POSTGRES_HOST=localhost  (or `host.docker.internal` if Postgres
#     is running in Docker and you're on Docker Desktop / WSL2)
#   - PORT=8001                (already the default)
make install                # host-side npm deps
make migrate-new NAME=init   # generates prisma/migrations/<ts>_init/
npm run start:dev
```

For a one-off schema sync without writing a migration, use
`npx prisma db push` — but **never** commit a DB whose schema was
established this way, because the next `migrate deploy` on a clean
DB will be a no-op.

## Docker run

```bash
# First, make sure category-service is up on the shared network:
(cd ../category-service && docker compose up -d)

# Then bring up product-service. `make up` copies .env.example -> .env
# automatically on first run, then builds + starts in the background.
make up
curl http://localhost:8001/api/healthz

# Or run by hand if you prefer:
cp .env.example .env
docker compose up -d --build
```

The container's entrypoint waits for Postgres, applies Prisma migrations,
then starts the Nest server. Stop the stack with
`docker compose down`; **destroy data** with `docker compose down -v`
(or `make nuke`).

## Database migrations

Migrations are Prisma-generated SQL files in `prisma/migrations/<timestamp>_<name>/`.
The committed baseline is `prisma/migrations/20260624053648_init/`.

**Applying migrations** happens automatically on container start
(`entrypoint.sh` runs `npx prisma migrate deploy`). The container
**hard-fails** if `prisma/migrations/` is empty or missing — there is
no `prisma db push` fallback, because silently mutating the schema
is how migration history gets lost.

**Authoring a new migration** from the host:

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate the migration SQL (Prisma CLI on the host reads .env
#    directly, so DATABASE_URL just works):
make migrate-new NAME=add_inventory_count
# 3. Review the generated file:
ls prisma/migrations/   # -> ..._add_inventory_count/migration.sql
cat prisma/migrations/..._add_inventory_count/migration.sql
# 4. Commit and rebuild:
git add prisma/migrations/
git commit -m "feat(product-service): add inventory_count column"
make up
```

`make migrate-new` requires the host-side npm deps (run `make install`
once). It also needs the Docker Postgres to be reachable from the
host; with `POSTGRES_HOST=host.docker.internal` in `.env` (the
default), this works on Docker Desktop / WSL2.

Never run `npx prisma db push` against this DB — it mutates the
schema without writing a migration file, and the next `migrate deploy`
on a clean DB will fail to recreate the schema.

## Make targets

`make help` lists them all. Common ones:

| Target                | What it does                                      |
|-----------------------|---------------------------------------------------|
| `make up`             | Copy `.env.example` -> `.env` if missing, then build + start |
| `make down`           | Stop the stack (keeps volumes)                    |
| `make logs`           | Tail logs for the Nest container                  |
| `make shell`          | Open a shell in the running product-service       |
| `make psql`           | Open psql against product-db                      |
| `make migrate`        | Apply pending migrations (runs inside the container) |
| `make migrate-status` | Show migration status (inside the container)      |
| `make migrate-new`    | Author a new migration (host-side; requires `NAME=`) |
| `make studio`         | Open Prisma Studio on http://localhost:5555       |
| `make install`        | Install host-side npm deps (for `migrate-new`)    |
| `make nuke`           | **Destructive** — stop and delete the DB volume   |

## Port allocation

This service binds to **`PORT=8001`** by default to avoid colliding with
`category-service` (which owns 8000). If you change `PORT` in `.env`,
the host-side mapping in `docker-compose.yml` (`"${PORT:-8001}:${PORT:-8001}"`)
follows automatically — no other change needed.

## Deviations from `category-service`

This service is NestJS/TypeScript rather than Django/Python. Per
`AGENTS.md` §1, the **shape** is identical to `category-service`, but
the **stack** is allowed to differ:

- `INSTALLED_APPS` → NestJS feature modules under `src/`.
- DRF `UNAUTHENTICATED_USER: None` → no equivalent needed (Nest has no
  implicit auth dependency).
- `gunicorn` → `node dist/main.js` in production,
  `nest start --watch` in development (`npm run start:dev`).
- `python manage.py migrate` → `npx prisma migrate deploy`.
- Trailing-slash 301 redirect trap (AGENTS.md §6.2) → not a Nest issue,
  but the controller still writes paths as `products/`, `products/:id/`
  for consistency.