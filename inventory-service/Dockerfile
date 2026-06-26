# --- Stage 1: build ---------------------------------------------------------
# Installs all deps (including dev) so we can compile TypeScript and run
# prisma generate. The output is /app/dist plus the generated Prisma client
# in node_modules, which we copy to the runtime stage.
FROM node:20-alpine AS builder

WORKDIR /app

# OpenSSL is required by Prisma's engine binary on Alpine.
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
COPY tsconfig.json nest-cli.json ./

# Install ALL deps (including dev) so we can compile.
RUN npm install

# Generate the Prisma client. This populates
# node_modules/.prisma/client and node_modules/@prisma/client.
RUN npx prisma generate

COPY src ./src

RUN npm run build

# --- Stage 2: runtime -------------------------------------------------------
# Slim runtime image. Only production deps. Prisma engine and generated
# client come from the builder. No TypeScript compiler at runtime.
# NOTE: unlike a typical Node Dockerfile, we deliberately do NOT bake
# NODE_ENV, PORT, or any other runtime config here. All env flows in
# from .env at compose-time so the image is environment-agnostic.
FROM node:20-alpine AS runtime

WORKDIR /app

# nc is used by entrypoint.sh to wait for Postgres. dumb-init reaps
# zombies and forwards signals so `docker stop` triggers a clean
# PrismaService.onModuleDestroy. bash is the entrypoint interpreter
# (shebang is `#!/usr/bin/env bash`); the slim node:20-alpine image
# doesn't ship it and BusyBox `env` won't resolve it from a bare PATH.
RUN apk add --no-cache bash openssl dumb-init netcat-openbsd

COPY package*.json ./
COPY prisma ./prisma

# Production deps + prisma CLI (needed at runtime for `migrate deploy`).
RUN npm install --omit=dev && npm install --no-save prisma@5.15.0

# Bring the compiled JS and the Prisma client from the builder.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# The actual port is whatever PORT in .env says; this is the default the
# image would listen on if you ran it with no env. The compose file
# publishes host:8002 -> container:8002, mirroring the .env default.
EXPOSE 8002

ENTRYPOINT ["dumb-init", "--", "/app/entrypoint.sh"]
# `node dist/main.js` is overridden in dev by ENVIRONMENT=development.
CMD ["node", "dist/main.js"]
