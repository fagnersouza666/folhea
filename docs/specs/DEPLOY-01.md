Plano do Arquiteto:

1. DNS: registro A folhea.app para o IP da VPS.
2. VPS: Docker com compose, clone em /opt/folhea com deploy key só de leitura, só portas 80 e 443.
3. .env: PUBLIC_DOMAIN=folhea.app e senhas novas para Postgres, Keycloak e client secret.
4. Primeira subida manual: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait; conferir login e cadastro.
5. Hook: webhook (adnanh) como serviço systemd em 127.0.0.1:9000, com token no header, rodando git pull --ff-only e compose up --build --wait; exposto pelo Caddy em /_deploy/<token>.
6. GitHub Actions: secret PRODUCTION_DEPLOY_HOOK, variable PRODUCTION_HEALTH_URL=[Folhea — Cada página conta](https://folhea.app/), variable PRODUCTION_HEALTH_PATHS=/healthz.
7. registrationAllowed: false e usuários criados na mão. Ligar o cadastro do Keycloak só durante o teste do Avaliador e desligar depois.



