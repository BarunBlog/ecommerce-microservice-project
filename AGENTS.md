# AGENTS.md

Operating manual for AI coding agents working in this repository.

> If anything here conflicts with code, **code wins** — open a PR to update
> this file. This document captures intent, decisions, and traps, not source
> of truth.

---

## 1. Project at a glance

**`ecommerce-microservice-project`** — a monorepo of Django + DRF
microservices that together power a small ecommerce platform.

| Service              | Status         | Purpose                                |
|----------------------|----------------|----------------------------------------|
| `category-service`   | **Implemented**| CRUD for the `Category` catalog.       |
| `product-service`    | Placeholder dir| (not started)                          |
| `cart-service`       | Placeholder dir| (not started)                          |
| `order-service`      | Placeholder dir| (not started)                          |
| `inventory-service`  | Placeholder dir| (not started)                          |
| `payment-service`    | Placeholder dir| (not started)                          |
| `notification-service` | Placeholder dir | (not started)                       |
| `user-service`       | Placeholder dir| (not started)                          |

`category-service` is the reference implementation. **Other services
should follow its architectural shape (§3), but are free to use a
different language/framework where it makes sense** — e.g.
`product-service` may be NestJS, `order-service` may be Go. Do not
assume Django everywhere just because `category-service` is Django.

Tech stack, locked in for the platform:
- **Backend language/framework is per-service.** The platform is a
  polyglot monorepo. `category-service` happens to be Python + Django
  + DRF; other services pick their own stack.
- **PostgreSQL 16** is the default database (one DB per service, no
  cross-service joins). If a service needs something else (e.g.
  Mongo, Redis), document the reason in its README.
- **Docker Compose** for local orchestration, regardless of stack.
- **WSL2 + Docker Desktop** is the dev environment.
- Production servers, migrations, etc. are the service's own choice
  (e.g. `category-service` uses gunicorn; a Node service might use
  `node` directly behind nginx, etc.).

---

## 2. Repo layout

```
ecommerce-microservice-project/
├── .gitignore                # editor, python, django, secrets, postman
├── AGENTS.md                 # this file
├── docker-compose.yml        # (currently 0 bytes — placeholder for root stack)
├── cart-service/             # empty placeholder
├── category-service/         # ★ reference implementation
│   ├── categories/           # the only Django app
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   └── migrations/
│   ├── category_service/     # Django project (settings, urls, wsgi)
│   │   └── settings.py
│   ├── Dockerfile
│   ├── docker-compose.yml    # service-level compose: db + service
│   ├── entrypoint.sh
│   ├── requirements.txt
│   ├── manage.py
│   ├── .env.example
│   ├── .env                  # gitignored
│   ├── myvenv/               # gitignored
│   └── README.md
├── inventory-service/        # empty placeholder
├── notification-service/     # empty placeholder
├── order-service/            # empty placeholder
├── payment-service/          # empty placeholder
├── product-service/          # empty placeholder
└── user-service/             # empty placeholder
```

> **Trap:** the **root** `docker-compose.yml` is intentionally 0 bytes.
> The real, working compose file for category-service lives at
> `category-service/docker-compose.yml`. Running `docker compose` from
> the project root with the empty root file gives the misleading
> `empty compose file` error — `cd <service>` first.

---

## 3. Reference architecture: `category-service`

When you build a new service, copy this **shape** — service-per-DB,
own compose file, `/healthz`, soft-delete, UUID PKs, no cross-service
joins, JSON in/JSON out. You do **not** have to copy the language or
framework (see §1). The §3.2 and §3.4 details are Django-specific
illustrations; equivalent idioms in your chosen stack are fine.

### 3.1 Service-per-DB, no cross-service joins

- Each service has its own PostgreSQL database and its own `category_*`
  container pair (`<service>-db`, `<service>`).
- Services **never** read another service's database. They call each
  other over HTTP. (RabbitMQ events are on the roadmap, not yet wired.)
- Foreign-key style references across services are stored as **UUID
  strings**, not as Django FKs. The `Category.id` field is a `UUIDField`
  for exactly this reason: `product-service` will hold category IDs
  without a cross-DB FK.

### 3.2 Stripped-down Django settings (Django services only)

`category_service/settings.py` is intentionally minimal:

```python
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "rest_framework",
    "categories",  # the only domain app
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]
```

**No** `django.contrib.auth`, `admin`, `sessions`, `messages`, or
`templates`. This is a JSON-only microservice. Adding any of these to
another service requires a written justification in its README.

#### Critical DRF gotcha

DRF lazily imports `django.contrib.auth.models.AnonymousUser` and
`Token` for its `UNAUTHENTICATED_USER` / `UNAUTHENTICATED_TOKEN`
fallbacks. Since we don't have `django.contrib.auth` in `INSTALLED_APPS`,
**every request crashes with a 500** unless you opt out:

```python
REST_FRAMEWORK = {
    # ...
    "UNAUTHENTICATED_USER": None,
    "UNAUTHENTICATED_TOKEN": None,
}
```

> If you copy a service from this repo and start getting 500s on every
> endpoint, check that these two keys are set. This is the #1 footgun.

### 3.3 Environment variables

All env-driven, with safe defaults so the service still starts in
dev. `.env.example` is the source of truth for keys.

| Var                  | Default                    | Notes                                  |
|----------------------|----------------------------|----------------------------------------|
| `DJANGO_SECRET_KEY`  | `insecure-dev-key-change-me` | must override in prod                |
| `DJANGO_DEBUG`       | `False`                    |                                        |
| `DJANGO_ALLOWED_HOSTS` | `*`                      | comma-separated                       |
| `POSTGRES_DB`        | `category_db`              |                                        |
| `POSTGRES_USER`      | `category_user`            |                                        |
| `POSTGRES_PASSWORD`  | *(required)*               | compose fails fast if unset            |
| `POSTGRES_HOST`      | `category-db`              | container hostname; override to `localhost` for venv dev |
| `POSTGRES_PORT`      | `5432`                     |                                        |
| `ENVIRONMENT`        | `production`               | `development` → runserver, else gunicorn |

`.env` is **gitignored**. Never commit it. Never paste real secrets
into chat.

### 3.4 Entry-point branching

`entrypoint.sh` chooses the server at boot:

```bash
ENVIRONMENT="${ENVIRONMENT:-production}"
if [ "$ENVIRONMENT" = "development" ]; then
    exec python manage.py runserver 0.0.0.0:8000
else
    exec gunicorn category_service.wsgi:application \
        --bind 0.0.0.0:8000 --workers 3 \
        --access-logfile - --error-logfile -
fi
```

- Production container: leave `ENVIRONMENT=production` → gunicorn,
  multi-worker, no auto-reload. **This is the default and what runs in
  Docker.**
- Local venv dev: set `ENVIRONMENT=development` → runserver with
  auto-reload.

> **Trap:** with `ENVIRONMENT=production` (gunicorn), editing `.py`
> files on the host does **not** reflect in the running container.
> Code changes require `docker compose up -d --build <service>` to
> take effect. This bit us hard during debugging — see §6.

### 3.5 Models: UUID PK, soft-delete, server-generated slug

```python
class Category(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120, unique=True)
    slug = models.SlugField(max_length=120, unique=True, blank=True)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if self.name:
            self.slug = slugify(self.name)[:120]
        super().save(*args, **kwargs)
```

Rules for new services:
- **UUID primary keys** (cross-service safe, non-enumerable).
- **Soft-delete** via `is_active` boolean. Hard delete is a separate
  `?hard=true` query param, never the default.
- **Slugs are server-generated** from `name`. Clients send `name` only;
  `slug` is in `read_only_fields`. `save()` regenerates the slug every
  time the row is saved, so a PUT-rename correctly updates the slug.

### 3.6 Serializers and read-only fields

`read_only_fields = ["id", "slug", "created_at", "updated_at"]`. Clients
never set these. The server always wins on `slug`.

### 3.7 Views: ?all=true pattern

Both list and detail views filter out `is_active=False` by default, and
respect a `?all=true` query param to include them. **But** writes
(PUT/PATCH/DELETE) must see soft-deleted rows, otherwise you can't
hard-delete or undelete. Pattern:

```python
def get_queryset(self):
    if self.request.method == "GET":
        qs = Category.objects.all()
        include_inactive = self.request.query_params.get("all", "").lower() == "true"
        return qs if include_inactive else qs.filter(is_active=True)
    return Category.objects.all()
```

This is the contract:
- `GET /api/<resource>/` and `GET /api/<resource>/{id}/` →
  active-only by default
- `GET ...?all=true` → include inactive
- `PUT/PATCH/DELETE` → see all rows (so you can `?hard=true` delete a
  soft-deleted row)

Custom `destroy()` returns HTTP 200 with a body for soft-deletes, and
HTTP 204 for `?hard=true` (real delete).

### 3.8 API conventions

- All routes are under `/api/<resource>/`.
- **Trailing slash required.** Django's `APPEND_SLASH` will 301-redirect
  `/api/categories/<uuid>` to `/api/categories/<uuid>/`, and that
  redirect is invisible in Postman (it shows as the original request).
  Always end URLs with `/` in docs, tests, and Postman.
- `GET /healthz` returns `{"status": "ok", "service": "<name>"}`.
  No auth. Used by Docker healthcheck.
- Pagination: `PageNumberPagination`, page size 50.

### 3.9 Docker

`category-service/docker-compose.yml` brings up:
- `category-db` (Postgres 16, named volume `category_db_data`, healthcheck via `pg_isready`)
- `category-service` (built from local `Dockerfile`, depends on healthy
  `category-db`, exposes 8000, healthcheck via `/healthz`)
- Network: `category-net` (bridge), unique name so multiple services can
  share a host without collision.

When you add a new service, copy this file and rename:
- containers: `<service>-db`, `<service>`
- volume: `<service>_db_data`
- network: `<service>-net` (or join a shared network if you wire one up)

---

## 4. Design practices and decisions

1. **One service = one responsibility.** `category-service` does not
   know about products, prices, or stock. The category document is
   intentionally tiny.
2. **JSON in, JSON out.** No HTML, no templates, no admin. The
   `INSTALLED_APPS` list is the documentation of this rule.
3. **No synchronous cross-service calls from request paths in the
   future.** When `product-service` exists, getting product details
   will either call `category-service` over HTTP at composition time
   (gateway) or via cached event data. Direct DB access between
   services is forbidden.
4. **Soft-delete as the default.** Hard delete is explicit, audited in
   the request (`?hard=true`), and rare.
5. **Server-generated slugs.** Clients don't pass them. This avoids
   URL-collision bugs and keeps URLs stable across renames only when
   you actually want them stable (you don't, here).
6. **All secrets via env.** `.env` is local-only. `.env.example` ships.
   Compose refuses to start without `POSTGRES_PASSWORD`.
7. **Healthchecks are part of the contract.** Every service must
   expose `/healthz` and have a Docker healthcheck that hits it.
8. **gunicorn in prod, runserver in dev.** The container's default is
   production. Local venv users opt into dev with one env var.

---

## 5. Common workflows

### Build and run a service
```bash
cd <service>
cp .env.example .env  # then edit
docker compose up -d --build
curl http://localhost:8000/healthz
```

### Tail logs
```bash
cd <service>
docker compose logs -f <service>
```

### Open a shell in the running container
```bash
cd <service>
docker compose exec <service> bash
python manage.py shell
```

### Run migrations
```bash
# Migrations run automatically on container start (see entrypoint.sh).
# To run them by hand:
docker compose exec <service> python manage.py migrate
```

### Reset the database (DESTRUCTIVE)
```bash
cd <service>
docker compose down -v  # -v removes the named volume
docker compose up -d --build
```

### Local venv dev (with auto-reload)
```bash
cd <service>
cp .env.example .env
# In .env set: ENVIRONMENT=development, POSTGRES_HOST=localhost
# Run a Postgres locally (or `docker compose up -d <service>-db`)
python -m venv myvenv
source myvenv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

---

## 6. Known traps (read before debugging)

### 6.1 gunicorn doesn't auto-reload

With `ENVIRONMENT=production` (the default in the container), code
edits on the host do **nothing** inside the running container. You
need `docker compose up -d --build <service>` to pick up changes.
This is by design — production gunicorn workers don't reload — but
it will burn you in dev if you forget. Switch to
`ENVIRONMENT=development` for venv dev, or get used to
`--build` after every code change.

### 6.2 Trailing-slash 301 redirects

`/api/categories/<uuid>` (no slash) 301-redirects to
`/api/categories/<uuid>/`. Postman shows this as the original
request, so it **looks** like your PUT/DELETE hit a GET. Always use
the trailing slash. The URL conf uses
`path("<uuid:id>/", ...)` for this reason.

### 6.3 DRF's hidden auth dependency

Already covered in §3.2. Symptom: every endpoint returns 500 with
`Model class django.contrib.auth.models.Permission doesn't declare
an explicit app_label`. Fix:
`UNAUTHENTICATED_USER: None`, `UNAUTHENTICATED_TOKEN: None`.

### 6.4 The `is_active` GET-after-DELETE illusion

If `GET /api/<resource>/{id}/` returns the soft-deleted row with
`is_active: false`, it can look like DELETE didn't work. This is
intentional (admin users with `?all=true` need to see the row), but
make sure your `get_queryset()` filters it out for the default GET
unless `?all=true` is passed. See §3.7.

### 6.5 The empty root `docker-compose.yml`

It's a placeholder. Don't try to use it. The service-level
`docker-compose.yml` is the one that works. The root file will
eventually orchestrate all services together — that's a future task.

---

## 7. Adding a new service (checklist)

The **shape** below is mandatory. The **stack** is your choice — see
§1. Steps marked `(Django)` only apply when the new service is Django;
substitute the equivalent in your framework.

1. `mkdir <service>` and `cd <service>`.
2. Pick your stack. If Django, copy the layout from `category-service/`
   as a starting point. If NestJS / Go / etc., scaffold with that
   framework's CLI, then add the items below.
3. **Own Docker Compose.** Copy `category-service/docker-compose.yml`,
   rename `<service>-db`, `<service>`, the volume, the network, and
   the healthcheck target. The compose brings up the service plus its
   DB and nothing else.
4. **`/healthz` endpoint** returning
   `{"status": "ok", "service": "<service>"}`. No auth. Used by the
   Docker healthcheck. Required for every service regardless of stack.
5. **UUID primary keys** and a soft-delete `is_active` boolean.
   Hard delete is a separate, explicit path (e.g. `?hard=true`).
6. **No cross-service joins / direct DB access.** Hold cross-service
   references as UUID strings and call the owning service over HTTP.
7. **JSON in, JSON out.** No templates, no admin, no auth (yet — see
   §8). If you must add `django.contrib.auth`, document why in the
   service's README.
8. **(Django)** Strip `INSTALLED_APPS` to `contenttypes`,
   `staticfiles`, `rest_framework`, your app. Set
   `UNAUTHENTICATED_USER: None` and `UNAUTHENTICATED_TOKEN: None` in
    `REST_FRAMEWORK` — see §3.2 and §6.3.
9. **(Django)** Server-generated slug from `name`, with
   `read_only_fields = ["id", "slug", "created_at", "updated_at"]`
   and a `save()` that always regenerates `slug` from `name`. See §3.5
   and §3.6.
10. **(Django)** `?all=true` filter pattern on `get_queryset()` so
    GETs default to active-only while writes still see soft-deleted
    rows. See §3.7.
11. **(Django)** Trailing slash on every URL pattern
    (`path("<uuid:id>/", ...)`). See §6.2.
12. **Env-driven config.** Ship `.env.example`, gitignore `.env`.
    `POSTGRES_PASSWORD` is required; everything else has a safe default.
13. Add `<service>/README.md` covering: scope, endpoints, query params,
    request body, local run, docker run, and any deviations from
    `category-service` (e.g. "this service uses MongoDB because…",
    "this service uses NestJS because…").
14. **Never** commit `.env`, `myvenv/`, `__pycache__/`, `.idea/`,
    `.puku/`, `.vscode/`, `postman/`, `.postman/`. The root
    `.gitignore` already covers these.

---

## 8. Out of scope (for now)

- **RabbitMQ events.** Mentioned in model docstrings and view
  docstrings as a future task (`categories/signals.py` will publish
  `category.created/updated/deleted`). Don't add the broker or
  signal wiring yet — it belongs to a later milestone.
- **Authentication.** No service has auth. All endpoints are
  `AllowAny`. Adding auth is a platform-wide decision, not per-service.
- **Cross-service composition / API gateway.** No gateway yet.
  Services call each other directly when needed.
- **CI/CD.** No pipelines configured. Local + Docker is the workflow.
- **Production deployment.** This repo is for local dev. Deployment
  to AWS/GCP/etc. is a separate concern.
- **Other six services** (`cart`, `inventory`, `notification`,
  `order`, `payment`, `product`, `user`) — empty placeholders. Build
  them following §7.

---

## 9. Git conventions

- Commit messages: `type(scope): short summary` then a blank line,
  then a bullet list of what changed. Example from history:
  `fix(category-service): slug regen on rename, soft-delete, ENVIRONMENT switch`
- Keep commits scoped. One commit per logical change.
- Don't commit:
  - `.env` (real secrets)
  - `myvenv/`, `__pycache__/`
  - `.idea/`, `.puku/`, `.vscode/`
  - `postman/`, `.postman/` (local Postman scratch)
  - The empty root `docker-compose.yml` (intentionally untracked for
    now)

---

## 10. Quick reference

| Question | Answer |
|----------|--------|
| Where does this service run? | `localhost:8000` (or whatever port) |
| Where's the compose? | `<service>/docker-compose.yml`, **not** the root |
| How do I add auth? | Don't, until the platform decides on a pattern |
| How do I add events? | Wait for the RabbitMQ milestone |
| Why is my edit not live? | gunicorn doesn't reload — `docker compose up -d --build` |
| Why does the trailing slash matter? | Django 301-redirects; Postman hides it |
| Why is everything 500? | Forgot `UNAUTHENTICATED_USER: None` in DRF settings |
| Why is the port stuck on 8000? | Docker Desktop port-proxy; `docker compose down`, wait, retry |
