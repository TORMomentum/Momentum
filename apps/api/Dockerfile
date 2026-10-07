# Build context is the repo root (see docker-compose.yml). Installed from the
# workspace root, not apps/api alone, so every @tor-radar/* package resolves to
# a real built package instead of a missing module (TOR-140).
#
# Debian-based, not alpine: alpine's musl/OpenSSL TLS stack has a documented
# history of failing the TLS handshake against MongoDB Atlas specifically
# ("SSL alert number 80" during MongoServerSelectionError) — seen on this
# deploy even with Atlas Network Access allowing the connecting IP.
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
# The whole packages/ tree, not one name at a time: "packages/*" is a workspace
# glob, and a Dockerfile that names each package by hand goes stale the moment
# a new one is added (found the hard way — packages/seeds broke this build).
COPY packages ./packages
# npm ci runs each package's own "prepare" (tsc) once it's linked, so their
# source has to be in place before this step, not copied in alongside apps/api.
RUN npm ci

COPY apps/api ./apps/api

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["npm", "start"]
