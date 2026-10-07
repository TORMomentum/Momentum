# Build context is the repo root (see docker-compose.yml). Installed from the
# workspace root, not apps/web alone, so every @tor-radar/* package resolves to
# a real built package instead of a missing module (TOR-140). Building inside
# the workspace also means Next's standalone output nests under apps/web, as
# its own monorepo-output docs describe.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
# The whole packages/ tree, not one name at a time: "packages/*" is a workspace
# glob, and a Dockerfile that names each package by hand goes stale the moment
# a new one is added (found the hard way — packages/seeds broke this build).
COPY packages ./packages
# npm ci runs each package's own "prepare" (tsc) once it's linked, so their
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
