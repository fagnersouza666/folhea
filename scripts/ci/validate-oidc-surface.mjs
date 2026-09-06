import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));

const compose = read('docker-compose.yml');
const prodCompose = read('docker-compose.prod.yml');
const caddy = read('infra/Caddyfile');
const env = read('.env.example');
const prodRealm = readJson('infra/keycloak/folhea-realm.prod.template.json');
const devRealm = readJson('infra/keycloak/folhea-realm.dev.template.json');

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

requireText(compose, 'quay.io/keycloak/keycloak:26.7.3@sha256:', 'Keycloak patched image');
requireText(compose, 'OIDC_AUTH_SERVER_URL: http://keycloak:8080/realms/folhea', 'Compose back-channel');
requireText(compose, 'OIDC_PUBLIC_AUTHORIZATION_URL: ${OIDC_PUBLIC_AUTHORIZATION_URL:?', 'Compose public authorization URL');
requireText(compose, 'OIDC_PUBLIC_LOGOUT_URL: ${OIDC_PUBLIC_LOGOUT_URL:?', 'Compose public logout URL');
requireText(compose, 'OIDC_TOKEN_ISSUER: ${OIDC_PUBLIC_ISSUER:?', 'Compose public issuer');
requireText(compose, 'OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET:?', 'Compose OIDC client secret');
requireText(compose, 'KC_HOSTNAME: ${OIDC_PUBLIC_ORIGIN:?', 'Keycloak public hostname');
requireText(compose, 'render-realm.sh', 'Keycloak realm render entrypoint');
requireText(prodCompose, 'KC_HOSTNAME_STRICT: "true"', 'Production Keycloak hostname strict');
requireText(prodCompose, 'folhea-realm.prod.template.json', 'Production realm template');
assert.ok(!/\n\s+ports:/.test(keycloak), 'Keycloak must not publish host ports');
requireText(caddyService, '      private:', 'Caddy must reach private Keycloak network');

for (const publicValue of [
  'OIDC_PUBLIC_ORIGIN=https://localhost:8443',
  'OIDC_PUBLIC_ISSUER=https://localhost:8443/realms/folhea',
  'OIDC_PUBLIC_AUTHORIZATION_URL=https://localhost:8443/realms/folhea/protocol/openid-connect/auth',
  'OIDC_PUBLIC_LOGOUT_URL=https://localhost:8443/realms/folhea/protocol/openid-connect/logout',
  'OIDC_CLIENT_SECRET=replace-with-a-long-random-oidc-client-secret'
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

const assertClient = (realm, label) => {
  const client = realm.clients.find((candidate) => candidate.clientId === 'folhea-api');
  assert.ok(client, `${label}: folhea-api client is missing`);
  assert.equal(client.publicClient, false, `${label}: client must be confidential`);
  assert.equal(client.secret, '${OIDC_CLIENT_SECRET}', `${label}: client secret must come from envsubst`);
  const audienceMapper = client.protocolMappers?.find((mapper) => mapper.name === 'folhea-api-audience');
  assert.equal(audienceMapper?.protocolMapper, 'oidc-audience-mapper');
  assert.equal(audienceMapper?.config?.['included.client.audience'], 'folhea-api');
  return client;
};

const prodClient = assertClient(prodRealm, 'Production realm');
assert.deepEqual(prodClient.redirectUris, ['https://folhea.com.br/auth/callback'], 'Production redirect URIs');
assert.deepEqual(prodClient.webOrigins, ['https://folhea.com.br'], 'Production web origins');
assert.ok(!prodClient.redirectUris.some((uri) => uri.includes('localhost')), 'Production realm must not include localhost');

const devClient = assertClient(devRealm, 'Development realm');
for (const redirectUri of ['http://localhost:8080/auth/callback', 'https://localhost:8443/auth/callback']) {
  assert.ok(devClient.redirectUris.includes(redirectUri), `Development redirect URI is missing ${redirectUri}`);
}

console.log('OIDC Compose/Caddy surface: valid');
