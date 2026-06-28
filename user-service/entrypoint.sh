#!/usr/bin/env bash
# entrypoint.sh — wait for Postgres, run migrations, then start the server.
#
# Server is chosen by ENVIRONMENT:
#   development -> Django runserver (auto-reload, dev only, NOT for prod)
#   production  -> gunicorn (default; multi-worker, what runs in Docker)
#
# Port comes from ${PORT:-8003} so the in-container bind always matches the
# docker-compose ports: "8003:8003" mapping (AGENTS.md §10).
set -e

echo "[entrypoint] Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
until nc -z "${POSTGRES_HOST}" "${POSTGRES_PORT}"; do
    sleep 1
done
echo "[entrypoint] PostgreSQL is up."

echo "[entrypoint] Running migrations..."
python manage.py migrate --noinput

ENVIRONMENT="${ENVIRONMENT:-production}"
PORT="${PORT:-8003}"
echo "[entrypoint] ENVIRONMENT=${ENVIRONMENT} PORT=${PORT}"

if [ "$ENVIRONMENT" = "development" ]; then
    echo "[entrypoint] Starting runserver (auto-reload)..."
    exec python manage.py runserver 0.0.0.0:${PORT}
else
    echo "[entrypoint] Starting gunicorn..."
    exec gunicorn user_service.wsgi:application \
        --bind 0.0.0.0:${PORT} \
        --workers 3 \
        --access-logfile - \
        --error-logfile -
fi