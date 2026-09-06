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
