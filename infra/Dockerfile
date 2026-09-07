# The default image is the Quarkus runtime. The compose stack uses the
# caddy-runtime target for the edge container, so neither runtime contains
# Node.js or a build toolchain.
# Regenerate digests: docker buildx imagetools inspect <image:tag>

FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS frontend-build
WORKDIR /workspace/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build -- --configuration production

FROM eclipse-temurin:25-jdk@sha256:e787e08ef76f4c16866108cd7f9fcd96a68eef3ac6cc76866897d4d02d5a2262 AS backend-build
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

FROM eclipse-temurin:25-jre-alpine@sha256:3137541deb3cac6626b5d9a4a2187bc0d6a34312f858bd2c67dd01e732e6b682 AS backend-runtime
WORKDIR /deployments
COPY --from=backend-build /workspace/backend/target/quarkus-app/ /deployments/quarkus-app/
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/deployments/quarkus-app/quarkus-run.jar"]
