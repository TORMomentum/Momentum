# Build context is the repo root (see docker-compose.yml). This is an npm-workspaces
# repo and the api imports @tor-radar/shared, so the image is built from the root
# with the committed lockfile. Installing apps/api on its own hits an npm arborist
# bug ("Cannot read properties of null (reading 'edgesOut')") and would miss the
# workspace package regardless.
FROM node:22-alpine
WORKDIR /app

# Root lockfile + every workspace manifest, and shared's source (npm ci runs its
# `prepare` build). This layer stays cached until one of them changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/ ./packages/shared/
RUN npm ci

# The api runs straight from TypeScript through tsx, so it needs no build of its own.
COPY apps/api/ ./apps/api/

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["npm", "start"]
