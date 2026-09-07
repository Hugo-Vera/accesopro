FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/catalog/package.json ./packages/catalog/
COPY apps/web/package.json ./apps/web/
RUN npm ci --workspace=@accesopro/web --include-workspace-root

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/catalog ./packages/catalog
COPY apps/web ./apps/web
COPY --from=deps /app/node_modules ./node_modules
# Vacío = el browser habla con :3000 (rewrites internos a la API)
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Destino de rewrites dentro de la red Docker
ARG API_INTERNAL_URL=http://api:8787
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build -w @accesopro/web

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
# Runtime: el route SSE y fetch server-side deben hablar con el servicio api (no localhost)
ENV API_INTERNAL_URL=http://api:8787
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
