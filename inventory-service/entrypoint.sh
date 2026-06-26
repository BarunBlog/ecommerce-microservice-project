#!/usr/bin/env bash
# Wait for Postgres + RabbitMQ, run Prisma migrations, then start the server.
# Server is chosen by ENVIRONMENT (mirrors category-service / product-service
# entrypoint.sh):
#   development -> `nest start --watch` (auto-reload; host-side venv-style)
#   production  -> `node dist/main.js`    (default; what runs in Docker)
set -e

# --- Defaults if env is not provided ---------------------------------------
# These match the dev defaults in .env.example so this script is safe to
# run before .env is loaded. Compose injects the real values via
# `env_file: .env` first.
: "${POSTGRES_HOST:=localhost}"
: "${POSTGRES_PORT:=5432}"
: "${RABBITMQ_HOST:=rabbitmq}"
: "${RABBITMQ_PORT:=5672}"
: "${ENVIRONMENT:=production}"
: "${PORT:=8002}"

echo "[entrypoint] ENVIRONMENT=${ENVIRONMENT}"

echo "[entrypoint] Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
ATTEMPT=0
MAX_ATTEMPTS=60
until nc -z "${POSTGRES_HOST}" "${POSTGRES_PORT}" 2>/dev/null; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
    echo "[entrypoint] Database not reachable after ${MAX_ATTEMPTS}s. Aborting."
    exit 1
  fi
  sleep 1
done
echo "[entrypoint] PostgreSQL is up."

echo "[entrypoint] Waiting for RabbitMQ at ${RABBITMQ_HOST}:${RABBITMQ_PORT}..."
ATTEMPT=0
until nc -z "${RABBITMQ_HOST}" "${RABBITMQ_PORT}" 2>/dev/null; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
    echo "[entrypoint] RabbitMQ not reachable after ${MAX_ATTEMPTS}s. Aborting."
    exit 1
  fi
  sleep 1
done
echo "[entrypoint] RabbitMQ is up."

# --- Apply Prisma migrations ----------------------------------------------
# `migrate deploy` is the production-safe command: applies pending
# migrations from prisma/migrations without prompting. The migrations
# directory is REQUIRED to be present and non-empty. There is no
# `db push` fallback — that command mutates the live schema without
# writing a migration file, which means the next person who clones the
# repo would have no migration history to replay. If migrations are
# missing, fail loudly so the operator notices and commits the SQL.
if [ ! -d "prisma/migrations" ] || [ -z "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "[entrypoint] FATAL: prisma/migrations is missing or empty."
  echo "[entrypoint] Generate the initial migration from your host with:"
  echo "[entrypoint]   make migrate-new NAME=init"
  echo "[entrypoint] Then commit the generated SQL and rebuild the image."
  exit 1
fi

echo "[entrypoint] Applying Prisma migrations..."
npx prisma migrate deploy

# --- Boot the app ---------------------------------------------------------
# We do NOT `exec` here; the Nest process becomes PID 1 of this script,
# which is the dumb-init entrypoint. dumb-init forwards SIGTERM from
# `docker stop` to the Node process, which triggers PrismaService's
# onModuleDestroy -> $disconnect. See AGENTS.md §3.4 / §7.1.
if [ "$ENVIRONMENT" = "development" ]; then
  echo "[entrypoint] Starting nest in watch mode..."
  exec npx nest start --watch
else
  echo "[entrypoint] Starting node ${PORT}..."
  exec node dist/main.js
fi