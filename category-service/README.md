# category-service

Django + DRF microservice that manages the `Category` catalog. Exposes
a full CRUD JSON API to other services in the ecommerce platform.

## Scope
- Owns `Category` records in its own PostgreSQL database.
- Full CRUD via the HTTP API below (no Django admin).
- No RabbitMQ events. Other services that need category data call this
  API directly.

## Endpoints
All under `/api/categories/`:

| Method   | Path        | Purpose |
|----------|-------------|---------|
| GET      | `/`         | List categories, active only by default. |
| POST     | `/`         | Create a category. |
| GET      | `/{id}/`    | Retrieve a category by UUID. |
| PUT      | `/{id}/`    | Full update of a category. |
| PATCH    | `/{id}/`    | Partial update of a category. |
| DELETE   | `/{id}/`    | Soft-delete (`is_active=False`) by default. `?hard=true` to actually delete the row. |
| GET      | `/healthz`  | Health check (no auth). |

### Query parameters

`GET /api/categories/` accepts:

| Param   | Default | Meaning |
|---------|---------|---------|
| `all`   | `false` | `?all=true` includes inactive categories in the list. |
| `page`  | `1`     | Page number for paginated results. |

### Request body (POST / PUT / PATCH)

```json
{
  "name": "Electronics",
  "description": "Phones, laptops, accessories",
  "is_active": true
}
```

`slug` is auto-generated from `name` and is not accepted from the
client. `id`, `created_at`, and `updated_at` are read-only.

## Local run (without Docker)
```bash
cp .env.example .env
# edit .env to point POSTGRES_HOST to localhost
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

## Docker run
The full docker-compose setup is added in a later step. For now this
service is built as a standalone container and expected to be wired
into `docker-compose.yml` along with its `category-db` Postgres.
