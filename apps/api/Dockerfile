# Build context is the repo root (see docker-compose.yml). Installed from the
# workspace root, not apps/api alone, so @tor-radar/shared resolves to a real
# built package instead of a missing module (TOR-140).
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared ./packages/shared
# npm ci runs packages/shared's own "prepare" (tsc) once it's linked, so its
# source has to be in place before this step, not copied in alongside apps/api.
RUN npm ci

COPY apps/api ./apps/api

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["npm", "start"]
