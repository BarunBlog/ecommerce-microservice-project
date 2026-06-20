#!/usr/bin/env bash
# Wait for Postgres, run migrations, then start gunicorn.
set -e

echo "[entrypoint] Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
until nc -z "${POSTGRES_HOST}" "${POSTGRES_PORT}"; do
  sleep 1
done
echo "[entrypoint] PostgreSQL is up."

echo "[entrypoint] Running migrations..."
python manage.py migrate --noinput

echo "[entrypoint] Starting gunicorn..."
exec gunicorn category_service.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 3 \
    --access-logfile - \
    --error-logfile -
