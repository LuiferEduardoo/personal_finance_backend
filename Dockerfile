# ---- builder: instala dependencias y compila ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# herramientas para compilar dependencias nativas (bcrypt)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runner: imagen final ----
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
# se copian node_modules (incluye ts-node, necesario para migration:run),
# el build (dist), y src + tsconfig porque el DataSource de migraciones es .ts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/tsconfig*.json ./
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
# corre las migraciones y luego levanta la app
ENTRYPOINT ["./docker-entrypoint.sh"]
