# The default image is the Quarkus runtime. The compose stack uses the
# caddy-runtime target for the edge container, so neither runtime contains
# Node.js or a build toolchain.
# Regenerate digests: docker buildx imagetools inspect <image:tag>

FROM node:26.12.0-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS frontend-build
WORKDIR /workspace/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
COPY shared/public-contract.json /workspace/shared/public-contract.json
RUN NG_BUILD_MAX_WORKERS=2 NODE_OPTIONS=--max-old-space-size=1536 npm run build -- --configuration production

FROM eclipse-temurin:27-jdk@sha256:2771efbbc159b89dc38b82ebe01312fd1b5f226071ff715ca9edd5411a389761 AS backend-build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/backend
COPY backend/ ./
RUN --mount=type=cache,target=/root/.m2 chmod +x mvnw && MAVEN_OPTS="-Xmx1024m -XX:ActiveProcessorCount=4" ./mvnw -B package -DskipTests

# The official 2.11.7 binary embeds Go 1.26.8/x/net 0.59.0. Overlay the same
# stable Caddy release with corrected, locked dependencies and standard modules.
# The build toolchain never enters the runtime image.
FROM golang:1.27.2-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS caddy-build
WORKDIR /workspace/caddy
ENV GOTOOLCHAIN=local GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org \
    CGO_ENABLED=0 GOMAXPROCS=4 GOMEMLIMIT=900MiB
COPY infra/caddy-build/go.mod infra/caddy-build/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download && go mod verify
COPY infra/caddy-build/main.go ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -mod=readonly -trimpath -buildvcs=false -tags nobadger,nomysql,nopgx -ldflags '-s -w' -o /out/caddy .

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f AS caddy-runtime
COPY --from=caddy-build /out/caddy /usr/bin/caddy
COPY --from=frontend-build /workspace/frontend/dist/folhea/browser /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
ENV PUBLIC_DOMAIN=localhost \
    OIDC_PUBLIC_ORIGIN=https://localhost:9443 \
    API_UPSTREAM=http://backend-edge:8080 \
    STATIC_ROOT=/srv
RUN --mount=type=tmpfs,target=/data --mount=type=tmpfs,target=/config caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
EXPOSE 80 443

FROM quay.io/keycloak/keycloak:26.8.1@sha256:79c623a22abacf3fe6c00a5fb30f5b7843d717b234033b80995891c06116d244 AS keycloak-runtime
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_METRICS_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM eclipse-temurin:27-jre-alpine@sha256:9d76de111573e77ac415d8344271a2e57dd19bd59c48725fa3bac38c101bd0ba AS backend-runtime
WORKDIR /deployments
COPY --from=backend-build /workspace/backend/target/quarkus-app/ /deployments/quarkus-app/
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/deployments/quarkus-app/quarkus-run.jar"]
