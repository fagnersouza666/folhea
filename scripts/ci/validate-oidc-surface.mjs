import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
const userProfile = readJson('infra/keycloak/user-profile.json');

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

requireText(compose, 'quay.io/keycloak/keycloak:26.8.0@sha256:', 'Keycloak patched image');
requireText(compose, 'OIDC_AUTH_SERVER_URL: http://keycloak:8080/realms/folhea', 'Compose back-channel');
requireText(compose, 'OIDC_PUBLIC_AUTHORIZATION_URL: ${OIDC_PUBLIC_AUTHORIZATION_URL:?', 'Compose public authorization URL');
requireText(compose, 'OIDC_PUBLIC_LOGOUT_URL: ${OIDC_PUBLIC_LOGOUT_URL:?', 'Compose public logout URL');
requireText(compose, 'OIDC_TOKEN_ISSUER: ${OIDC_PUBLIC_ISSUER:?', 'Compose public issuer');
requireText(compose, 'OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET:?', 'Compose OIDC client secret');
requireText(compose, 'KC_HOSTNAME: ${OIDC_PUBLIC_ORIGIN:?', 'Keycloak public hostname');
requireText(compose, '["/bin/bash", "/opt/keycloak/render-realm.sh"]', 'Keycloak realm render entrypoint');
const renderRealm = read('infra/keycloak/render-realm.sh');
requireText(renderRealm, 'mkdir -p', 'Keycloak realm import directory must exist before secret substitution');
assert.ok(!/\benvsubst\b/.test(renderRealm), 'Keycloak image has no gettext; render the realm in bash');
requireText(renderRealm, 'sed -f "$sed_script"', 'Keycloak realm secret is applied via a sed script file');

requireText(renderRealm, 'OIDC_CLIENT_SECRET', 'Keycloak realm secret variable');
const localOverride = read('docker-compose.override.example.yml');
requireText(localOverride, '127.0.0.1:5433:5432', 'Local Postgres publish for quarkus:dev');
requireText(localOverride, '127.0.0.1:8180:8080', 'Local Keycloak publish for quarkus:dev');
requireText(localOverride, 'KC_HOSTNAME: http://localhost:8180', 'Local Keycloak hostname for ng serve OIDC');
requireText(prodCompose, 'KC_HOSTNAME_STRICT: "true"', 'Production Keycloak hostname strict');
requireText(prodCompose, 'folhea-realm.prod.template.json', 'Production realm template');
assert.ok(!/\n\s+ports:/.test(keycloak), 'Keycloak must not publish host ports');
requireText(caddyService, '      private:', 'Caddy must reach private Keycloak network');
const backend = serviceBlock('backend', 'caddy');
requireText(backend, '          - backend-edge', 'BFF needs an edge-only DNS alias');
assert.ok(!backend.slice(backend.indexOf('      private:')).includes('backend-edge'), 'Edge alias must not exist on the private network');
requireText(caddyService, 'API_UPSTREAM: ${API_UPSTREAM:-http://backend-edge:8080}', 'Caddy must use the trusted edge connection');
requireText(caddy, '@application-policy not path ' + oidcPublicMatcher, 'IdP theme CSP must stay independent of Angular CSP');
requireText(caddy, "header @application-policy Content-Security-Policy", 'Folhea retains its strict CSP');

for (const publicValue of [
  'OIDC_PUBLIC_ORIGIN=https://localhost:9443',
  'OIDC_PUBLIC_ISSUER=https://localhost:9443/realms/folhea',
  'OIDC_PUBLIC_AUTHORIZATION_URL=https://localhost:9443/realms/folhea/protocol/openid-connect/auth',
  'OIDC_PUBLIC_LOGOUT_URL=https://localhost:9443/realms/folhea/protocol/openid-connect/logout',
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
requireText(caddy, 'handle @oidc-public {', 'Caddy OIDC handler');
requireText(caddy, 'reverse_proxy keycloak:8080', 'Caddy OIDC upstream');
requireText(caddy, 'handle @auth {', 'Caddy BFF handler');
requireText(caddy, 'handle @api {', 'Caddy API handler');
requireText(caddy, 'reverse_proxy {$API_UPSTREAM}', 'Caddy BFF upstream');
for (const name of ['X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto']) {
  requireText(caddy, 'header_up ' + name, 'Canonical forwarded header');
  assert.ok(!caddy.includes('header_up -' + name + '\n'), `Caddy deletes run after sets: ${name} must not be deleted`);
}

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
assert.deepEqual(prodClient.redirectUris, ['${OIDC_PUBLIC_ORIGIN}/auth/callback'], 'Production redirect URIs');
assert.deepEqual(prodClient.webOrigins, ['${OIDC_PUBLIC_ORIGIN}'], 'Production web origins');
assert.ok(!prodClient.redirectUris.some((uri) => uri.includes('localhost')), 'Production realm must not include localhost');

const devClient = assertClient(devRealm, 'Development realm');
for (const redirectUri of [
  'http://localhost:8080/auth/callback',
  'http://localhost:4200/auth/callback',
  '${OIDC_PUBLIC_ORIGIN}/auth/callback'
]) {
  assert.ok(devClient.redirectUris.includes(redirectUri), `Development redirect URI is missing ${redirectUri}`);
}
for (const origin of ['http://localhost:8080', 'http://localhost:4200', '${OIDC_PUBLIC_ORIGIN}']) {
  assert.ok(devClient.webOrigins.includes(origin), `Development web origin is missing ${origin}`);
}

for (const [realm,label] of [[devRealm,'dev'],[prodRealm,'prod']]) {
  const profileComponent = realm.components['org.keycloak.userprofile.UserProfileProvider'][0];
  assert.equal(profileComponent.providerId, 'declarative-user-profile');
  assert.deepEqual(JSON.parse(profileComponent.config['kc.user.profile.config'][0]), userProfile);
  for (const name of ['firstName', 'lastName']) {
    assert.equal(userProfile.attributes.find(attribute => attribute.name === name)?.required, undefined,
      `${label}: email/password registration must not require names at first login`);
  }
  assert.deepEqual(userProfile.attributes.find(attribute => attribute.name === 'email')?.required, {roles:['user']});
  assert.equal(realm.defaultLocale, 'pt-BR');
  assert.equal(realm.registrationAllowed, true, `${label}: registration belongs to Keycloak`);
  assert.equal(realm.registrationEmailAsUsername, true, `${label}: email supplies the IdP username`);
  assert.ok(!realm.loginTheme, `${label}: retain Keycloak's default theme`);
  assert.equal(realm.adminEventsEnabled, true, `${label}: administrative actions must be audited`);
  assert.equal(realm.adminEventsDetailsEnabled, false, `${label}: omit private representations`);
  assert.ok(realm.clients.every(client => client.directAccessGrantsEnabled === false), `${label}: no password grant`);
  const registration=realm.clients.find(c=>c.clientId==='folhea-registration');
  assert.equal(registration.secret,'${KEYCLOAK_ADMIN_CLIENT_SECRET}', label);
  assert.equal(registration.serviceAccountsEnabled,true,label);
  assert.equal(registration.fullScopeAllowed,false,label);
  assert.equal(registration.standardFlowEnabled,false,label);
  assert.equal(registration.attributes?.['access.token.lifespan'],'300',label);
  assert.deepEqual(realm.users[0].clientRoles['realm-management'],['manage-users']);
}
execFileSync('bash',[path.join(root,'scripts/tests/test-render-realm.sh')],{stdio:'inherit'});
const logoutRenderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folhea-logout-realm-'));
try {
  for (const [profile, expected] of [
    ['dev', ['https://localhost:9443/auth/logged-out', 'http://localhost:8080/auth/logged-out', 'http://localhost:4200/auth/logged-out']],
    ['prod', ['https://localhost:9443/auth/logged-out']]
  ]) {
    const output = path.join(logoutRenderDir, `${profile}.json`);
    execFileSync('bash', [path.join(root, 'infra/keycloak/render-realm.sh')], {
      env: { ...process.env, OIDC_CLIENT_SECRET: 'realm-render-test-secret',
        KEYCLOAK_ADMIN_CLIENT_SECRET: 'realm-render-test-admin-secret',
        OIDC_PUBLIC_ORIGIN: 'https://localhost:9443',
        KEYCLOAK_REALM_TEMPLATE: path.join(root, `infra/keycloak/folhea-realm.${profile}.template.json`),
        KEYCLOAK_REALM_OUTPUT: output, FOLHEA_REALM_RENDER_ONLY: '1' }
    });
    const client = JSON.parse(fs.readFileSync(output, 'utf8')).clients.find(c => c.clientId === 'folhea-api');
    assert.deepEqual(client.attributes?.['post.logout.redirect.uris']?.split('##'), expected,
      `${profile}: rendered realm must authorize the exact post-logout return paths`);
  }
} finally {
  fs.rmSync(logoutRenderDir, { recursive: true, force: true });
}
if (process.env.EDGE_BASE_URL) {
  const origin = new URL(process.env.EDGE_BASE_URL).origin;
  for (const [url, status] of [
    ['/api/v1/me',401], ['/auth/login',302], ['/auth/logout',302],
    ['/auth/logged-out',403], ['/auth/logged-out?state=not-a-real-state',403],
    ['/auth/logged-out?state=one&state=two',403], ['/admin/realms',404],
    ['/realms/folhea/protocol/openid-connect/token',404],
    ['/realms/folhea/protocol/openid-connect/certs',404], ['/q',404], ['/q/metrics',404],
    ['/__edge_acceptance_missing__',404],
    ['/app',200], ['/app/inicio',200], ['/entrar',200], ['/cadastro',200]
  ]) {
    const response = await fetch(origin + url, {redirect:'manual',signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,status,`Real edge route ${url}`);
    if (url.startsWith('/auth/logged-out')) {
      assert.match(response.headers.get('content-type') ?? '', /application\/problem\+json/i);
      const problem = await response.json();
      assert.equal(problem.status, 403, 'Invalid post-logout state must be rejected');
      assert.ok(!response.headers.has('location'), 'Invalid post-logout state must not redirect');
      assert.match(response.headers.get('set-cookie') ?? '', /q_post_logout_Default_folhea=[^;]*;[^\n]*Max-Age=0/i,
        'Invalid post-logout state must expire its cookie');
    }
    if (url === '/auth/login' || url === '/auth/logout') {
      const challenge = new URL(response.headers.get('location'));
      assert.equal(challenge.origin,origin);
      assert.equal(challenge.pathname,'/realms/folhea/protocol/openid-connect/auth');
      assert.equal(challenge.searchParams.get('code_challenge_method'),'S256');
      assert.ok(challenge.searchParams.get('nonce'));
      assert.ok(challenge.searchParams.get('state'));
      const idp = await fetch(challenge, { signal: AbortSignal.timeout(10000) });
      assert.equal(idp.status, 200, 'Public IdP challenge');
      const providerPolicy = idp.headers.get('content-security-policy') ?? '';
      assert.match(providerPolicy, /object-src 'none'/, 'Keycloak owns its theme CSP');
      assert.match(providerPolicy, /frame-ancestors/, 'Provider clickjacking policy must be preserved');
      assert.ok(!providerPolicy.includes("script-src 'self';"), 'Angular CSP must not replace the provider theme policy');
    }
    if (['/app','/app/inicio','/entrar','/cadastro'].includes(url)) {
      assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self';/, 'Private application scripts remain restricted to self');
      assert.match(response.headers.get('cache-control') ?? '', /no-store/i);
      assert.match(response.headers.get('x-robots-tag') ?? '', /noindex.*nofollow/i);
      assert.match(await response.text(), /<folhea-root(?:\s[^>]*)?>\s*<\/folhea-root>/,
        `Private route ${url} must return the empty CSR shell`);
    }
  }
  console.log('Real edge: private API 401, OIDC challenge/PKCE and forbidden surfaces 404');
}
console.log('OIDC Compose/Caddy surface: valid');
