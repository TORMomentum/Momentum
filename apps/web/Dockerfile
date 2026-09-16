# Build context is the repo root (see docker-compose.yml). Built from the root so
# the install matches the committed lockfile and does not trip the npm arborist
# bug a lone-package install hits.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/shared/ ./packages/shared/
RUN npm ci

COPY apps/web/ ./apps/web/
RUN npm run build --workspace @tor-radar/web

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
# Next's standalone bundle nests under apps/web/ because the workspace root is one
# level up; server.js and its node_modules come from that tree.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
