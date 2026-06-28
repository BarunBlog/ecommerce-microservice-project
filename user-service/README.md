# user-service

Owns the platform's identity layer: custom user model, authentication,
profile data, and JWT issuance.

## Stack

- **Language / framework:** Python 3.12 + Django 6.0 + DRF
- **Database:** PostgreSQL 16 (per-service DB, container name `user-db`)
- **Server:** Django `runserver` on port `8003` (dev only — swap to gunicorn
  for prod, see `category-service/entrypoint.sh` for the prod branch)
- **Config:** `django-environ` reading `.env`

## Endpoints

| Method | Path             | Purpose                  | Notes                |
|--------|------------------|--------------------------|----------------------|
| GET    | `/healthz`       | Liveness probe           | No auth.             |

(Further endpoints to be added under `users/` and `profiles/` once those
apps are wired up — out of scope for this initial bootstrap.)

All routes live under `/api/<resource>/` with a **trailing slash**
(see AGENTS.md §3.8 / §6.2).

## Environment variables

See `.env.example`. Every key has a safe default except `POSTGRES_PASSWORD`,
which `docker-compose` refuses to start without.

| Var                  | Default                  | Notes                                  |
|----------------------|--------------------------|----------------------------------------|
| `DJANGO_SECRET_KEY`  | `insecure-dev-key-...`   | Override in prod.                      |
| `DJANGO_DEBUG`       | `False`                  |                                        |
| `DJANGO_ALLOWED_HOSTS` | `*`                    | Comma-separated.                       |
| `POSTGRES_DB`        | `user_db`                |                                        |
| `POSTGRES_USER`      | `user_user`              |                                        |
| `POSTGRES_PASSWORD`  | *(required)*             | Compose fails fast if unset.           |
| `POSTGRES_HOST`      | `localhost`              | Compose overrides to `user-db`.        |
| `POSTGRES_PORT`      | `5432`                   |                                        |
| `PORT`               | `8003`                   | In-container bind port.                |

## Local run (docker)

```bash
cd user-service
cp .env.example .env              # then edit POSTGRES_PASSWORD
docker compose up -d --build
curl http://localhost:8003/healthz
```

## Local run (host venv + container DB)

```bash
cd user-service
cp .env.example .env
# In .env set: POSTGRES_HOST=localhost (or your local Postgres)
python -m venv myvenv
source myvenv/bin/activate
pip install -r requirements.txt
# Either run the DB via `docker compose up -d user-db` or use a local Postgres.
python manage.py migrate
python manage.py runserver 0.0.0.0:8003
```

## Networking

This service is mounted on **two** networks in `docker-compose.yml`:

- `user-net` (internal) — service ↔ its own `user-db`.
- `shared-platform-net` (external, pre-created by `infra/docker-compose.yml`)
  — gives this container DNS access to the shared `rabbitmq` broker for
  future event publishing (e.g. `users.event.created`).

## Deviations from `category-service`

- **Auth + admin + sessions are kept in `INSTALLED_APPS`.** AGENTS.md §3.2
  strips them out for the read-only JSON microservices, but
  user-service is an *authentication* service — the custom user model and
  JWT pipeline need them. Justification recorded per AGENTS.md §7.7.
- **DRF's lazy auth fallbacks are intentionally left enabled.** No need
  for the `UNAUTHENTICATED_USER: None` workaround (category-service
  §3.2 trap) — `django.contrib.auth` is present here.
- **Single-stage Dockerfile with no non-root user.** Matches the spec for
  this bootstrap. For prod, add a non-root user + gunicorn (see
  `category-service/Dockerfile`).
- **Dev server (`runserver`), not gunicorn.** Spec calls for `runserver`
  on `0.0.0.0:8003` in the entrypoint. No `ENVIRONMENT` switch — this
  service is dev-mode for now.
- **Port 8003** (next free slot after category=8000, product=8001,
  inventory=8002). AGENTS.md §10 port-allocation table updated.