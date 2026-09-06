import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const compose = read('docker-compose.yml');
const caddy = read('infra/Caddyfile');
const env = read('.env.example');
const realm = JSON.parse(read('infra/keycloak/folhea-realm.json'));

const requireText = (source, text, label) => {
  assert.ok(source.includes(text), `${label}: expected ${text}`);
};

const serviceBlock = (name, nextService) => {
  const start = compose.search(new RegExp(`^  ${name}:`, 'm'));
  const end = compose.search(new RegExp(`^  ${nextService}:`, 'm'));
  assert.ok(start >= 0 && end > start, `Compose service ${name} is missing`);
  return compose.slice(start, end);
};

const keycloak = serviceBlock('keycloak', 'backend');
const caddyStart = compose.search(/^  caddy:/m);
const caddyEnd = compose.search(/^volumes:/m);
assert.ok(caddyStart >= 0 && caddyEnd > caddyStart, 'Compose service caddy is missing');
const caddyService = compose.slice(caddyStart, caddyEnd);
const oidcPublicMatcher = caddy.match(/\n\s*@oidc-public path ([^\n]+)/)?.[1] ?? '';

requireText(compose, 'OIDC_AUTH_SERVER_URL: http://keycloak:8080/realms/folhea', 'Compose back-channel');
requireText(compose, 'OIDC_PUBLIC_AUTHORIZATION_URL: ${OIDC_PUBLIC_AUTHORIZATION_URL:?', 'Compose public authorization URL');
requireText(compose, 'OIDC_PUBLIC_LOGOUT_URL: ${OIDC_PUBLIC_LOGOUT_URL:?', 'Compose public logout URL');
requireText(compose, 'OIDC_TOKEN_ISSUER: ${OIDC_PUBLIC_ISSUER:?', 'Compose public issuer');
requireText(compose, 'KC_HOSTNAME: ${OIDC_PUBLIC_ORIGIN:?', 'Keycloak public hostname');
assert.ok(!/\n\s+ports:/.test(keycloak), 'Keycloak must not publish host ports');
requireText(caddyService, '      private:', 'Caddy must reach private Keycloak network');

for (const publicValue of [
  'OIDC_PUBLIC_ORIGIN=https://localhost:8443',
  'OIDC_PUBLIC_ISSUER=https://localhost:8443/realms/folhea',
  'OIDC_PUBLIC_AUTHORIZATION_URL=https://localhost:8443/realms/folhea/protocol/openid-connect/auth',
  'OIDC_PUBLIC_LOGOUT_URL=https://localhost:8443/realms/folhea/protocol/openid-connect/logout'
]) requireText(env, publicValue, 'Local OIDC environment');

for (const path of [
  '/realms/folhea/protocol/openid-connect/auth',
  '/realms/folhea/protocol/openid-connect/logout',
  '/realms/folhea/login-actions/*',
  '/resources/*'
]) assert.ok(oidcPublicMatcher.includes(path), `Caddy OIDC surface must include ${path}`);

for (const forbidden of ['/admin', '/realms/master', '/token', '/introspect', '/certs', '/userinfo', 'realm-management']) {
  assert.ok(!oidcPublicMatcher.includes(forbidden), `Caddy OIDC surface must not expose ${forbidden}`);
}
requireText(caddy, 'reverse_proxy @oidc-public keycloak:8080', 'Caddy OIDC upstream');
requireText(caddy, 'reverse_proxy @auth {$API_UPSTREAM}', 'Caddy BFF upstream');

const client = realm.clients.find((candidate) => candidate.clientId === 'folhea-api');
assert.ok(client, 'Keycloak folhea-api client is missing');
for (const redirectUri of ['https://folhea.com.br/auth/callback', 'https://localhost:8443/auth/callback']) {
  assert.ok(client.redirectUris.includes(redirectUri), `Keycloak redirect URI is missing ${redirectUri}`);
}
const audienceMapper = client.protocolMappers?.find((mapper) => mapper.name === 'folhea-api-audience');
assert.equal(audienceMapper?.protocolMapper, 'oidc-audience-mapper');
assert.equal(audienceMapper?.config?.['included.client.audience'], 'folhea-api');

console.log('OIDC Compose/Caddy surface: valid');
