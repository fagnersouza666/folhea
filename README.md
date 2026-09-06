# Folhea

Folhea is a reading habit tracker. The backend is a Java 25 / Quarkus 3.33 monolith with PostgreSQL and Flyway.

## Backend

Start PostgreSQL locally with `docker compose up -d postgres`, then run:

```bash
cd backend
./mvnw quarkus:dev
```

The API is rooted at `/api/v1`; OpenAPI is available at `/api/openapi`. Configure OIDC and database credentials through environment variables rather than committing secrets.

## License

Licensed under the Apache License 2.0.

You are free to use, modify, distribute and commercialize this software.

Attribution to the original project and author must be preserved as described
in the LICENSE and NOTICE files.

## Segurança

O modelo de ameaças e o baseline obrigatório do v1 estão em
[`docs/security/threat-model.md`](docs/security/threat-model.md) e
[`docs/security/baseline.md`](docs/security/baseline.md). A configuração de
borda está em [`infra/Caddyfile`](infra/Caddyfile); o workflow de CI bloqueia
segredos, vulnerabilidades e misconfigurações de severidade alta/crítica.
