# user-service/Dockerfile — single-stage Python/Django dev image.
#
# Kept intentionally simple per the spec: no multi-stage build, no custom
# non-root user. Suitable for local dev under docker compose. For prod,
# layer in a non-root user + gunicorn + slim image swap (see
# category-service/Dockerfile for the prod pattern).

FROM python:3.12-slim

# Sane Python defaults for containerized Django:
#   - PYTHONDONTWRITEBYTECODE: no .pyc files littering the volume
#   - PYTHONUNBUFFERED: stdout/stderr flush immediately (docker logs is live)
#   - PIP_NO_CACHE_DIR: smaller image, faster rebuilds
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps:
#   - build-essential / libpq-dev : compile psycopg2-binary wheels if needed
#   - netcat-openbsd              : used by entrypoint.sh to wait for Postgres
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        netcat-openbsd \
 && rm -rf /var/lib/apt/lists/*

# Install Python deps first so this layer caches independently of source.
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Now copy the rest of the source.
COPY . .

# Make the entrypoint executable.
RUN chmod +x entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]