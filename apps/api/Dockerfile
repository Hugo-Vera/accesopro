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
COPY package.json package-lock.json ./
COPY packages/catalog ./packages/catalog
COPY apps/api ./apps/api
COPY --from=deps /app/node_modules ./node_modules
WORKDIR /app/apps/api
EXPOSE 8787
VOLUME ["/app/apps/api/data"]
CMD ["npm", "start"]
