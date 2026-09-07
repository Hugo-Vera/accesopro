FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/catalog/package.json ./packages/catalog/
COPY apps/api/package.json ./apps/api/
RUN npm ci --workspace=@accesopro/api --include-workspace-root

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0

# git + docker CLI (self-update desde el dashboard, con socket montado)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git \
    && curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.1.1.tgz \
      | tar -xz -C /tmp \
    && mv /tmp/docker/docker /usr/local/bin/docker \
    && mkdir -p /usr/local/lib/docker/cli-plugins \
    && curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
      https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64 \
    && chmod +x /usr/local/bin/docker /usr/local/lib/docker/cli-plugins/docker-compose \
    && rm -rf /tmp/docker /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/catalog ./packages/catalog
COPY apps/api ./apps/api
COPY --from=deps /app/node_modules ./node_modules
WORKDIR /app/apps/api
EXPOSE 8787
VOLUME ["/app/apps/api/data"]
CMD ["npm", "start"]
