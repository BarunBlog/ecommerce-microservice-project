# category-service

Pure CRUD Django + DRF service for product categories.

## Scope
- Manages `Category` records in its own PostgreSQL database.
- No RabbitMQ events in this step. Events will be added when a real
  consumer (e.g. notification-service) needs them.

## Endpoints
All under `/api/categories/`:

| Method | Path | Purpose |
|---|---|---|
| GET    | `/`            | List categories. `?all=true` to include inactive. |
| GET    | `/active/`     | List only active categories. |
| POST   | `/`            | Create a category. |
| GET    | `/{id}/`       | Retrieve a category. |
| PUT/PATCH | `/{id}/`    | Update a category. |
| DELETE | `/{id}/`       | Soft-delete (`is_active=False`). `?hard=true` to actually delete. |
| GET    | `/healthz`     | Health check (no auth). |

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
