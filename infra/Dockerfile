# The default image is the Quarkus runtime. The compose stack uses the
# caddy-runtime target for the edge container, so neither runtime contains
# Node.js or a build toolchain.
# Regenerate digests: docker buildx imagetools inspect <image:tag>

FROM node:26.11.1-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a AS frontend-build
WORKDIR /workspace/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build -- --configuration production

FROM eclipse-temurin:27-jdk@sha256:2771efbbc159b89dc38b82ebe01312fd1b5f226071ff715ca9edd5411a389761 AS backend-build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/backend
COPY backend/ ./
RUN chmod +x mvnw && ./mvnw -B package -DskipTests

FROM caddy:2.11-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS caddy-runtime
COPY --from=frontend-build /workspace/frontend/dist/folhea/browser /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
ENV PUBLIC_DOMAIN=localhost \
    API_UPSTREAM=http://backend:8080 \
    STATIC_ROOT=/srv
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
EXPOSE 80 443

FROM eclipse-temurin:27-jre-alpine@sha256:9d76de111573e77ac415d8344271a2e57dd19bd59c48725fa3bac38c101bd0ba AS backend-runtime
WORKDIR /deployments
COPY --from=backend-build /workspace/backend/target/quarkus-app/ /deployments/quarkus-app/
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/deployments/quarkus-app/quarkus-run.jar"]
