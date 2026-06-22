#!/usr/bin/env bash
# Wait for Postgres, run migrations, then start the server.
# Server is chosen by ENVIRONMENT:
#   development -> Django runserver (auto-reload, dev only, NOT for prod)
#   production  -> gunicorn (default; multi-worker, what runs in Docker)
set -e

echo "[entrypoint] Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
until nc -z "${POSTGRES_HOST}" "${POSTGRES_PORT}"; do
    sleep 1
done
echo "[entrypoint] PostgreSQL is up."

echo "[entrypoint] Running migrations..."
python manage.py migrate --noinput

ENVIRONMENT="${ENVIRONMENT:-production}"
echo "[entrypoint] ENVIRONMENT=${ENVIRONMENT}"

if [ "$ENVIRONMENT" = "development" ]; then
    echo "[entrypoint] Starting runserver (auto-reload)..."
    exec python manage.py runserver 0.0.0.0:8000
else
    echo "[entrypoint] Starting gunicorn..."
    exec gunicorn category_service.wsgi:application \
        --bind 0.0.0.0:8000 \
        --workers 3 \
        --access-logfile - \
        --error-logfile -
fi
