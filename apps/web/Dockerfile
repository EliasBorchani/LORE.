# syntax=docker/dockerfile:1
# The web app served by Caddy. Build context: the repository root (the app needs the engine's JavaScript library).
#   docker build -f apps/web/Dockerfile .

# 1. The engine as a JavaScript library. iOS targets are skipped on Linux; the heap stays small for a 4 GB server.
FROM eclipse-temurin:21-jdk AS engine
WORKDIR /src/engine
COPY engine/ ./
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon -Dorg.gradle.jvmargs=-Xmx1536m :core:jsBrowserProductionLibraryDistribution

# 2. The web app (type-check + bundle).
FROM node:22-slim AS web
COPY --from=engine /src/engine/core/build/dist/js/productionLibrary /src/engine/core/build/dist/js/productionLibrary
WORKDIR /src/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY apps/web/ ./
RUN npm run build

# 3. Caddy: HTTPS, the app's files, and /api forwarded to the server.
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /src/apps/web/dist /srv
