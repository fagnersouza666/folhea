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
  for (const profile of ['dev','prod']) {
    execFileSync('bash',[path.join(root,'infra/keycloak/render-realm.sh')],{env:{...env,KEYCLOAK_REALM_TEMPLATE:path.join(root,`infra/keycloak/folhea-realm.${profile}.template.json`)}});
    const realm=JSON.parse(fs.readFileSync(env.KEYCLOAK_REALM_OUTPUT,'utf8'));
    const bff=realm.clients.find(c=>c.clientId==='folhea-api');
    const admin=realm.clients.find(c=>c.clientId==='folhea-registration');
    assert.equal(bff.secret,secret);assert.equal(admin.secret,secret);
    assert.ok(bff.redirectUris.includes(env.OIDC_PUBLIC_ORIGIN+'/auth/callback'));
    assert.equal(admin.fullScopeAllowed,false);assert.equal(admin.standardFlowEnabled,false);
    assert.deepEqual(realm.users[0].clientRoles['realm-management'],['manage-users']);
    assert.equal(fs.statSync(env.KEYCLOAK_REALM_OUTPUT).mode&0o777,0o600);
    console.log('ok - '+profile+' realm has valid JSON, literal secrets and scoped registration client');
  }
  assert.throws(()=>execFileSync('bash',[path.join(root,'infra/keycloak/render-realm.sh')],{env:{...env,OIDC_CLIENT_SECRET:''},stdio:'pipe'}));
  assert.throws(()=>execFileSync('bash',[path.join(root,'infra/keycloak/render-realm.sh')],{env:{...env,OIDC_PUBLIC_ORIGIN:'https://example.com/evil'},stdio:'pipe'}));
  console.log('ok - invalid origin and missing secrets fail without leaking values');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
JS
