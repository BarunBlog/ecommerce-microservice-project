# inventory-service

Headless NestJS microservice that owns **product stock quantities** for the
ecommerce platform. Speaks JSON, persists to its own PostgreSQL via Prisma,
auto-provisions inventory rows by listening to the `products.event.created`
event from `product-service` on the platform's RabbitMQ topic exchange, and
exposes signed stock-adjustment and stock-lookup endpoints.

## Stack

- **Language/framework:** TypeScript + NestJS 10 (strict mode)
- **Database / ORM:** PostgreSQL 16 + Prisma 5
- **Async messaging:** `@nestjs/microservices` (RabbitMQ topic exchange, consumer)
- **Validation:** `class-validator` + `class-transformer`

## Scope (and what it does NOT own)

- Owns `Inventory` records (stock counts, reserved counts, warehouse
  location, created/updated timestamps).
- References products by `productId` UUID string — **no DB-level FK** to
  product-service. The database is fully isolated; cross-service
  references are scalar pointers per AGENTS.md §3.1.
- Does **not** own product records (owned by `product-service`).
- Does **not** own category records (owned by `category-service`).
- Reservation lifecycle is intentionally out of scope for now; only
  the `reservedCount` column is reserved for future use.

## RabbitMQ events consumed

| Routing key                | Exchange          | Reaction |
|----------------------------|-------------------|----------|
| `products.event.created`   | `ecommerce.events`| Upsert an `Inventory` row for the new product with `stockCount: 0`. Idempotent: existing rows are preserved. |

The exchange is declared as `topic` + `durable` by `product-service`.
This service declares its own **durable** queue
(`inventory-service.products.created` by default, configurable via
`RABBITMQ_QUEUE`) bound to that exchange with the routing key
`products.event.created`. Other routing keys published by
`product-service` (`products.event.updated`, `products.event.deleted`)
are not consumed.

Event payload shape (per `product-service`):

```json
{
  "event": "products.event.created",
  "occurredAt": "2026-06-25T10:00:00.000Z",
  "data": { "id": "8b7a6c1e-3c2b-4d3a-9c0e-1f2a3b4c5d6e", "...": "..." }
}
```

The consumer only reads `data.id`; unknown fields are ignored. A
malformed payload (missing or non-UUID `data.id`) is logged and
acknowledged without provisioning — we never requeue a poison message.

## Endpoints

All under `/api/inventory/`:

| Method | Path          | Purpose |
|--------|---------------|---------|
| GET    | `/:productId` | Look up current stock for a product. Returns 404 if no row has been provisioned yet. |
| POST   | `/adjust`     | Signed warehouse stock adjustment. `quantity` is positive to increment, negative to decrement. Refuses to drive `stockCount` below 0. |
| GET    | `/healthz`    | `{"status":"ok","service":"inventory-service"}`. No auth. |

### Response shape (GET /:productId)

```json
{
  "id": "9f8e7d6c-...",
  "productId": "8b7a6c1e-3c2b-4d3a-9c0e-1f2a3b4c5d6e",
  "stockCount": 42,
  "reservedCount": 3,
  "available": 39,
  "location": "Main Warehouse",
  "createdAt": "2026-06-25T10:00:00.000Z",
  "updatedAt": "2026-06-25T10:00:00.000Z"
}
```

`available` is derived (`stockCount - reservedCount`) and never persisted.

### Request body (POST /adjust)

```json
{ "productId": "8b7a6c1e-3c2b-4d3a-9c0e-1f2a3b4c5d6e", "quantity": 10 }
```

- `quantity > 0` → increment (incoming shipment, customer returns).
- `quantity < 0` → decrement (write-off, shrinkage).
- `quantity = 0` → 400 (almost certainly a client bug).
- Adjustment would drive `stockCount < 0` → 400.

## Environment variables

See `.env.example`. Notable keys:

| Var                | Default                                            | Notes |
|--------------------|----------------------------------------------------|-------|
| `PORT`             | `8002`                                             | Nest HTTP port |
| `DATABASE_URL`     | `postgresql://inventory_user:...@inventory-db:5432/inventory_db` | Prisma DSN |
| `RABBITMQ_URL`     | `amqp://guest:guest@rabbitmq:5672`                 | AMQP URI; hostname resolves over `shared-platform-net` |
| `RABBITMQ_EXCHANGE`| `ecommerce.events`                                 | Topic exchange name |
| `RABBITMQ_QUEUE`   | `inventory-service.products.created`               | Durable consumer queue |

## Local run (without Docker)

```bash
cp .env.example .env
# In .env:
#   - keep POSTGRES_PASSWORD at the dev default, or set your own
#   - POSTGRES_HOST=localhost  (or `host.docker.internal` if Postgres
#     is running in Docker and you're on Docker Desktop / WSL2)
#   - PORT=8002                (already the default)
make install
make migrate-new NAME=init
npm run start:dev
```

For a one-off schema sync without writing a migration, use
`npx prisma db push` — but **never** commit a DB whose schema was
established this way, because the next `migrate deploy` on a clean
DB will be a no-op.

## Docker run

```bash
# First, make sure shared infra (RabbitMQ) is up on shared-platform-net:
(cd ../infra && docker compose up -d)

# Then bring up inventory-service. `make up` copies .env.example -> .env
# automatically on first run, then builds + starts in the background.
(cd inventory-service && make up)
curl http://localhost:8002/api/healthz
```

The container's entrypoint waits for Postgres and RabbitMQ, applies
Prisma migrations, then starts the Nest server. Stop the stack with
`docker compose down`; **destroy data** with `docker compose down -v`
(or `make nuke`).

## Database migrations

Migrations are Prisma-generated SQL files in `prisma/migrations/<timestamp>_<name>/`.
The committed baseline is `prisma/migrations/20260625000000_init/`.

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
git commit -m "feat(inventory-service): add inventory_count column"
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
| `make shell`          | Open a shell in the running inventory-service     |
| `make psql`           | Open psql against inventory-db                    |
| `make migrate`        | Apply pending migrations (runs inside the container) |
| `make migrate-status` | Show migration status (inside the container)      |
| `make migrate-new`    | Author a new migration (host-side; requires `NAME=`) |
| `make studio`         | Open Prisma Studio on http://localhost:5555       |
| `make install`        | Install host-side npm deps (for `migrate-new`)    |
| `make nuke`           | **Destructive** — stop and delete the DB volume   |

## Port allocation

This service binds to **`PORT=8002`** by default to avoid colliding with
`category-service` (8000) and `product-service` (8001). If you change
`PORT` in `.env`, the host-side mapping in `docker-compose.yml`
(`"${PORT:-8002}:${PORT:-8002}"`) follows automatically — no other
change needed.

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
  but the controller still writes paths as `inventory/:productId` for
  consistency with `products/:id`.

This service also diverges from `product-service` in **direction of
messaging**: it is a consumer-only service. `product-service` only
publishes; `inventory-service` only consumes. Both attach to the same
shared-platform-net and the same `ecommerce.events` exchange.