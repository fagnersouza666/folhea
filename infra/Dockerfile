# The default image is the Quarkus runtime. The compose stack uses the
# caddy-runtime target for the edge container, so neither runtime contains
# Node.js or a build toolchain.

FROM node:22-alpine AS frontend-build
WORKDIR /workspace/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build -- --configuration production

FROM eclipse-temurin:25-jdk AS backend-build
WORKDIR /workspace/backend
COPY backend/ ./
RUN chmod +x mvnw && ./mvnw -B package -DskipTests

FROM caddy:2.10-alpine AS caddy-runtime
COPY --from=frontend-build /workspace/frontend/dist/folhea/browser /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443

FROM eclipse-temurin:25-jre-alpine AS backend-runtime
WORKDIR /deployments
COPY --from=backend-build /workspace/backend/target/quarkus-app/ /deployments/quarkus-app/
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/deployments/quarkus-app/quarkus-run.jar"]
