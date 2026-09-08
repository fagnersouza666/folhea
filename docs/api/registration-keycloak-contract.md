# Contrato server-side do cadastro no Keycloak

**Referência:** `fo-lp7` / `hq-2e7y.3.1.1`
**Status:** contrato aprovado para a implementação do provisionamento
**Escopo:** entrada pública do cadastro, chamada privada ao Keycloak e
respostas observáveis pelo BFF/frontend.

Este documento separa o contrato que o navegador conhece do contrato interno
usado pelo backend para provisionar a conta. O navegador chama somente o BFF do
Folhea. Ele nunca chama a API administrativa do Keycloak e nunca recebe
credencial técnica, client secret, access token administrativo ou a resposta
bruta do provedor.

## 1. Limite de confiança

```text
Browser/PWA
    │ HTTPS: e-mail + senha
    ▼
Folhea BFF/Quarkus
    │ rede privada/TLS: token técnico + UserRepresentation
    ▼
Keycloak Admin REST API
```

O endpoint administrativo de criação é o `POST
/admin/realms/{realm}/users` da [referência oficial da Admin REST
API](https://www.keycloak.org/docs-api/latest/rest-api/index.html). `{realm}`
é o nome do realm (`folhea`), não um valor fornecido pelo cliente.

Somente o BFF pode obter e usar o token técnico necessário para essa chamada.
O cliente `folhea-api` usado no fluxo OIDC do navegador não deve ser usado como
substituto de uma credencial técnica de provisionamento; a integração deve
usar uma credencial server-side dedicada e de menor privilégio, conforme o
contrato de integração segura.

## 2. Contrato público Folhea → BFF

### Endpoint

```http
POST /api/v1/auth/register
Content-Type: application/json
Accept: application/json
```

`POST /api/v1/register` permanece como rota de compatibilidade para clientes
legados. As duas rotas aceitam exatamente o mesmo payload e produzem a mesma
resposta; novos clientes devem usar `/api/v1/auth/register`.

### Payload de entrada

O corpo contém somente os campos aprovados para o cadastro:

```json
{
  "email": "Ana@EXAMPLE.COM",
  "password": "senha-fornecida-pelo-usuario"
}
```

| Campo | Tipo | Obrigatório | Regra server-side |
| --- | --- | --- | --- |
| `email` | string | sim | Remove espaços periféricos, normaliza NFC, converte para minúsculas, exige formato de e-mail e aceita no máximo 320 caracteres. |
| `password` | string | sim | Não pode ser vazia; aceita entre 8 e 128 caracteres. A política adicional do realm continua sendo autoridade do Keycloak. |

Campos adicionais (`confirmPassword`, `name`, `timezone`, `userId`, `sub`,
`clientId` ou qualquer outro) não fazem parte do contrato e devem ser
rejeitados. O cliente não informa o realm, o identificador do usuário, grupos,
roles ou atributos administrativos.

O BFF deve validar e normalizar o e-mail antes de chamar o Keycloak. A senha
recebida é apenas encaminhada na requisição server-side de provisionamento; não
deve ser registrada, persistida no Folhea, incluída em métricas/traces ou
devolvida em qualquer resposta.

## 3. Payload interno BFF → Keycloak

Depois da validação, o BFF envia ao endpoint administrativo, usando o token
técnico em um header `Authorization` que nunca atravessa a fronteira do
navegador:

```http
POST {KEYCLOAK_INTERNAL_ORIGIN}/admin/realms/folhea/users
Authorization: Bearer <token-tecnico-obtido-pelo-backend>
Content-Type: application/json
```

O corpo é uma `UserRepresentation` mínima. O valor mostrado para `value` é
somente um placeholder documental, nunca um valor para fixture ou log:

```json
{
  "username": "ana@example.com",
  "email": "ana@example.com",
  "enabled": true,
  "emailVerified": false,
  "credentials": [
    {
      "type": "password",
      "value": "<senha-apenas-em-memoria>",
      "temporary": false
    }
  ]
}
```

Regras do payload interno:

- `username` e `email` usam o e-mail já normalizado pelo BFF;
- `enabled` é `true` para permitir o login após o cadastro aprovado;
- `emailVerified` é `false` até que uma política de verificação de e-mail seja
  aprovada e implementada;
- `temporary` é `false`, pois o cadastro não deve forçar troca de senha sem
  decisão de produto;
- o navegador não escolhe `id`, `realm`, roles, grupos, required actions ou
  atributos administrativos;
- o corpo e o token técnico existem somente durante a operação server-side; não
  podem ser persistidos em banco, cache, log ou artefato, e o cliente HTTP não
  deve retê-los além do necessário para a chamada.

O BFF não deve consultar tabelas internas do Keycloak. Para vincular a conta,
usa o identificador emitido pelo próprio provedor: em uma criação bem-sucedida,
o Admin REST API responde `201 Created` e fornece o identificador do usuário no
header `Location`, normalmente no formato
`/admin/realms/folhea/users/{keycloak-user-id}`. A resposta administrativa
normalmente não possui corpo útil; o BFF não deve depender de um JSON de
usuário retornado pelo provedor.

## 4. Vínculo e resposta pública de sucesso

O BFF só pode responder sucesso depois de:

1. o Keycloak confirmar a criação com `201 Created`;
2. o BFF extrair o `keycloak-user-id` do `Location` retornado pelo provedor;
3. o registro local ser criado com `identitySubject` igual a esse identificador
   emitido pelo Keycloak; e
4. a transação local ser confirmada.

O `sub` usado pelo login posterior é sempre o subject validado pelo OIDC; ele
não vem do body, query string ou header enviado pelo navegador. Se o vínculo
local falhar depois da criação no Keycloak, o backend deve executar compensação
segura ou reconciliação idempotente server-side antes de permitir uma nova
tentativa. Nunca deve retornar `200`/`201` parcial.

A resposta pública sanitizada do BFF é:

```http
HTTP/1.1 201 Created
Content-Type: application/json
Cache-Control: no-store
Location: /api/v1/me
```

```json
{
  "id": "<id-local-do-folhea>",
  "email": "ana@example.com"
}
```

`id` é o identificador interno do registro de domínio do Folhea. O
`keycloak-user-id`, o `sub`, o token técnico, o client secret e a resposta
administrativa do Keycloak não fazem parte da resposta pública. O `Location`
privado do Keycloak também nunca é repassado ao cliente; a única localização
pública é `/api/v1/me`.

## 5. Regras que todos os clientes devem observar

- Usar HTTPS na origem pública e não armazenar a senha em `localStorage`,
  `sessionStorage`, IndexedDB, URL, cookie ou analytics.
- Não incluir `Authorization` administrativo em código JavaScript, proxy do
  frontend, CORS, resposta HTTP, log, exception ou artefato de teste.
- Não registrar o corpo completo da requisição/resposta. Logs podem conter
  somente rota, status, latência e identificador operacional não sensível.
- Aplicar `Cache-Control: no-store` na resposta pública e não permitir cache do
  payload de cadastro.
- O login posterior continua usando o fluxo OIDC/BFF existente; o endpoint de
  cadastro não cria login local nem devolve tokens.
- Os status e mensagens públicos para validação, conflito, limite e falha do
  provedor seguem o contrato de erros do cadastro. O corpo, código interno e
  mensagem bruta do Keycloak nunca são encaminhados.

## 6. Compatibilidade com a implementação

Este arquivo define o contrato aprovado para o provisionamento server-side. A
rota atualmente existente no backend ainda contém o comportamento legado de
cadastro local; ela não é evidência de que o provisionamento no Keycloak já
esteja concluído. A implementação de `hq-2e7y.3.2` deve adequar o fluxo a este
contrato, removendo a persistência local de senha e vinculando o usuário ao
identificador emitido pelo Keycloak.
