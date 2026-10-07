# Build context is the repo root (see docker-compose.yml). Installed from the
# workspace root, not apps/web alone, so @tor-radar/shared resolves to a real
# built package instead of a missing module (TOR-140). Building inside the
# workspace also means Next's standalone output nests under apps/web, as its
# own monorepo-output docs describe.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared ./packages/shared
# npm ci runs packages/shared's own "prepare" (tsc) once it's linked, so its
# source has to be in place before this step, not copied in alongside apps/web.
RUN npm ci

COPY apps/web ./apps/web
RUN npm run build -w apps/web

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
