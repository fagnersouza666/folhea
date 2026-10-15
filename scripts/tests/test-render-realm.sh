#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
node --input-type=module - "$ROOT" <<'JS'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root=process.argv[2];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'folhea-realm-'));
try {
  const secret='a$(id)&b/c\\d"quoted\nnewline\ttab';
  const env={...process.env,OIDC_CLIENT_SECRET:secret,KEYCLOAK_ADMIN_CLIENT_SECRET:secret,OIDC_PUBLIC_ORIGIN:'https://localhost:9443',KEYCLOAK_REALM_OUTPUT:path.join(dir,'out.json'),FOLHEA_REALM_RENDER_ONLY:'1'};
  for (const origin of ['http://localhost','https://localhost:9443','https://folhea.app']) {
   for (const profile of ['dev','prod']) {
    const profileEnv={...env,OIDC_PUBLIC_ORIGIN:origin,KEYCLOAK_REALM_TEMPLATE:path.join(root,`infra/keycloak/folhea-realm.${profile}.template.json`)};
    execFileSync('bash',[path.join(root,'infra/keycloak/render-realm.sh')],{env:profileEnv});
    const realm=JSON.parse(fs.readFileSync(env.KEYCLOAK_REALM_OUTPUT,'utf8'));
    assert.equal(realm.attributes?.frontendUrl,origin,profile+': realm frontend URL comes from the public origin');
    const bff=realm.clients.find(c=>c.clientId==='folhea-api');
    const admin=realm.clients.find(c=>c.clientId==='folhea-registration');
    assert.equal(bff.secret,secret);assert.equal(admin.secret,secret);
    assert.ok(bff.redirectUris.includes(origin+'/auth/callback'));
    assert.ok(bff.webOrigins.includes(origin));
    assert.ok(bff.attributes?.['post.logout.redirect.uris'].split('##').includes(origin+'/auth/logged-out'));
    if (profile==='prod') {
      assert.deepEqual(bff.redirectUris,[origin+'/auth/callback']);
      assert.deepEqual(bff.webOrigins,[origin]);
      assert.equal(bff.attributes['post.logout.redirect.uris'],origin+'/auth/logged-out');
    } else {
      for (const localOrigin of ['http://localhost:8080','http://localhost:4200']) {
        assert.ok(bff.redirectUris.includes(localOrigin+'/auth/callback'));
        assert.ok(bff.webOrigins.includes(localOrigin));
        assert.ok(bff.attributes['post.logout.redirect.uris'].split('##').includes(localOrigin+'/auth/logged-out'));
      }
    }
    assert.equal(admin.fullScopeAllowed,false);assert.equal(admin.standardFlowEnabled,false);
    assert.equal(realm.registrationAllowed,true,profile+': Keycloak owns self-registration');
    assert.equal(realm.registrationEmailAsUsername,true,profile+': email supplies the IdP username');
    assert.ok(!realm.loginTheme,profile+': retain the provider default login theme');
    assert.equal(realm.adminEventsEnabled,true,profile+': administrative deletion must be audited');
    assert.equal(realm.adminEventsDetailsEnabled,false,profile+': omit private request representations from audit');
    assert.equal(admin.attributes?.['access.token.lifespan'],'300',profile+': deletion service tokens expire within five minutes');
    assert.ok(realm.clients.every(client=>client.directAccessGrantsEnabled===false),profile+': no password grant');
    assert.deepEqual(realm.users[0].clientRoles['realm-management'],['manage-users']);
    assert.equal(fs.statSync(env.KEYCLOAK_REALM_OUTPUT).mode&0o777,0o600);
    console.log('ok - '+profile+' '+origin+' realm has coherent public URLs, literal secrets and scoped deletion/recovery client');
   }
  }
  assert.throws(()=>execFileSync('bash',[path.join(root,'infra/keycloak/render-realm.sh')],{env:{...env,OIDC_CLIENT_SECRET:''},stdio:'pipe'}));
  assert.throws(()=>execFileSync('bash',[path.join(root,'infra/keycloak/render-realm.sh')],{env:{...env,OIDC_PUBLIC_ORIGIN:'https://example.com/evil'},stdio:'pipe'}));
  console.log('ok - invalid origin and missing secrets fail without leaking values');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
JS
