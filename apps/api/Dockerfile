# Build context is the repo root (see docker-compose.yml).
FROM node:22-alpine
WORKDIR /app

COPY apps/api/package.json ./
# ponytail: no per-app lockfile (root workspace holds it); switch to `npm ci` with a
# copied root lock if build reproducibility matters.
RUN npm install

COPY apps/api/ ./

EXPOSE 4000
CMD ["npm", "start"]
