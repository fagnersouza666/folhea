# Contrato server-side do cadastro no Keycloak

**Referência:** `fo-lp7` / `hq-2e7y.3.1.1`; integração segura: `hq-2e7y.3.2.1`
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

## 6. Integração administrativa segura

Esta é a decisão operacional para a credencial usada pelo provisionamento. Ela
é separada do cliente OIDC `folhea-api`, que continua reservado ao fluxo de
login do BFF. O backend deve falhar durante o startup se a configuração
obrigatória estiver ausente ou inconsistente; não existe fallback para uma
conta administrativa ou para o cliente OIDC.

### Credencial e permissões

| Item | Decisão | Regra de segurança |
| --- | --- | --- |
| Realm | `folhea` | Fixo no backend; nunca é lido do payload do cadastro. |
| Client ID | `folhea-registration-provisioner` | Cliente confidencial dedicado ao BFF; o valor não é controlado pelo navegador. |
| Autenticação | `client_secret_basic` | O client secret é enviado somente no header `Authorization: Basic` da requisição de token; nunca em query string ou body. |
| Grant | `client_credentials` | Não há usuário, login interativo, redirect URI ou direct access grant. |
| Service account | habilitada | Conta técnica sem acesso ao console e sem sessão de usuário. |
| Role mínima | `realm-management/manage-users` no realm `folhea` | Permite o ciclo de usuários necessário (`GET` por e-mail, `POST` e `DELETE` por ID). |
| Roles proibidas | `realm-admin`, `admin`, `manage-realm`, `manage-clients`, `view-clients`, `impersonation`, roles de grupos e roles de mapeamento | Não conceder privilégios fora do recurso Users. Não usar `Full Scope Allowed`. |

O cliente técnico não deve ser o `admin-cli`, o usuário bootstrap
`KEYCLOAK_ADMIN_*` ou o cliente `folhea-api`. A role `manage-users` deve ser
atribuída diretamente à service account no client `realm-management`; não deve
ser obtida por mapper, grupo amplo ou role composta criada para administradores.
Se o realm adotar permissões administrativas de granularidade fina, a
alternativa aprovada é conceder apenas `view` e `manage` do recurso Users ao
service account, sem também atribuir `realm-admin`.

### Endpoints permitidos

O backend recebe apenas a origem interna do Keycloak; o realm e os caminhos
abaixo são constantes da integração. O cliente HTTP deve rejeitar redirects,
validar o certificado TLS em produção e não aceitar um host derivado da
requisição pública.

| Finalidade | Método e caminho | Resposta esperada |
| --- | --- | --- |
| Obter token técnico | `POST /realms/folhea/protocol/openid-connect/token` | `200` com `access_token`; descartar o token ao terminar a operação. |
| Detectar duplicidade | `GET /admin/realms/folhea/users?email={email-normalizado}&exact=true&briefRepresentation=true&max=2` | `200`; qualquer resultado é conflito. O backend não persiste a representação. |
| Criar usuário | `POST /admin/realms/folhea/users` | Somente `201` com `Location` válido é sucesso. |
| Compensar criação órfã | `DELETE /admin/realms/folhea/users/{id-retornado-na-criação}` | Usar somente o ID extraído da criação atual; nunca apagar por e-mail. |

Não são permitidos endpoints do console, master realm, token de usuário,
introspection, `kcadm`, consulta de tabelas do Keycloak ou qualquer chamada de
roles/grupos/clientes durante o cadastro. O `Location` da criação deve ser
interpretado como um caminho relativo e deve corresponder exatamente a
`/admin/realms/folhea/users/{id}`; uma URL absoluta, host diferente, query,
fragmento, caminho extra ou ID vazio torna o resultado ambíguo e impede o
sucesso público.

### Segredos e configuração

Os nomes abaixo formam o contrato de configuração do adaptador. Os valores
devem vir do secret manager ou de variáveis injetadas fora do Git; os valores de
produção não devem ser colocados em `.env`, argumentos do processo, imagem ou
arquivo de realm versionado.

| Configuração | Exemplo não secreto/default | Obrigatoriedade |
| --- | --- | --- |
| `KEYCLOAK_ADMIN_ORIGIN` | `http://keycloak:8080` somente em desenvolvimento isolado; `https://keycloak.internal` em produção | Obrigatória; origem, sem `/admin` ou `/realms`. |
| `KEYCLOAK_ADMIN_REALM` | `folhea` | Obrigatória e imutável para esta integração. |
| `KEYCLOAK_PROVISIONING_CLIENT_ID` | `folhea-registration-provisioner` | Obrigatória; não aceitar valor vindo do request. |
| `KEYCLOAK_PROVISIONING_CLIENT_SECRET` | nenhum | Obrigatória em ambientes que habilitam o cadastro; segredo crítico, com rotação controlada. |
| `KEYCLOAK_ADMIN_CONNECT_TIMEOUT` | `PT2S` | Limite de conexão TCP/TLS. |
| `KEYCLOAK_ADMIN_READ_TIMEOUT` | `PT3S` | Limite de leitura da resposta. |
| `KEYCLOAK_ADMIN_REQUEST_TIMEOUT` | `PT5S` | Prazo total por chamada; menor que o timeout público do endpoint. |

O secret é lido somente pela camada de configuração, não deve ser impresso em
logs de startup e deve ser removido de qualquer objeto de requisição assim que
a chamada de token terminar. O access token não deve ser persistido em banco,
Redis, cache distribuído, MDC, métrica ou arquivo. A rotação substitui o secret
no secret manager e reinicia o BFF; o client anterior deve ser revogado depois
da confirmação de que todas as instâncias usam o novo valor.

Em desenvolvimento, HTTP só é permitido para o host privado do Compose e
nunca para uma origem fornecida pelo cliente. Em produção, exigir HTTPS com
validação normal da cadeia e do hostname. Ausência do secret, origem pública,
realm diferente de `folhea` ou URI que já contenha um caminho administrativo é
erro de configuração e deve deixar o cadastro indisponível, sem tentar usar
credenciais alternativas.

### Timeout, repetição e descarte de dados

- Não repetir automaticamente o `POST /users`: timeout depois do envio deixa o
  resultado indeterminado e uma segunda criação pode gerar uma conta órfã ou
  associar o registro errado. O caso deve seguir reconciliação server-side.
- Não seguir redirects e limitar o corpo lido da resposta administrativa a
  poucos KiB; para `201`, consumir somente headers/status e descartar o corpo.
- O token técnico, a senha do usuário e o `UserRepresentation` ficam apenas na
  memória durante a chamada. Logs, traces e métricas registram somente rota
  fixa, status, duração, categoria do erro e um request ID não sensível.
- O timeout de token e o timeout de administração usam a mesma política; um
  `401`/`403` nunca dispara tentativa com outra credencial.

### Mapeamento interno para o contrato público

O adaptador deve converter status e falhas em categorias controladas antes de
alcançar o recurso REST. Mensagens e corpos retornados pelo Keycloak são
descartados.

| Resultado interno | Categoria | Resposta pública |
| --- | --- | --- |
| Token `200` sem `access_token`, token endpoint `400/401/403`, ou `401/403` no Admin API | `provider_auth_or_config` | `503 registration-unavailable` |
| Admin API `400` por payload/política de senha conhecida | `validation_error` | `400 invalid-registration` |
| Admin API `409` ou usuário encontrado na consulta exata | `conflict_error` | `409 registration-unavailable` |
| Admin API `404` para realm/caminho fixo, `5xx`, `429`, falha TLS, DNS, conexão ou timeout | `provider_error` | `503 registration-unavailable` |
| `201` sem `Location` válido ou resposta fora do contrato | `ambiguous_provider_result` | `503 registration-unavailable`; iniciar reconciliação, sem novo create automático |
| Associação local falha após `201` | `local_link_error` | `503 registration-unavailable`; compensar somente pelo ID recém-retornado |
| Compensação falha ou não pode ser confirmada | `compensation_error` | `503 registration-unavailable`; encaminhar para reconciliação |

Os valores `400`, `409` e `503` acima são as projeções descritas em
[`docs/contrato-erros-cadastro.md`](../contrato-erros-cadastro.md). Qualquer
status, header, corpo ou exceção não reconhecida segue o caminho seguro de
`503`/`provider_error`; nenhuma falha administrativa vira sucesso.

## 7. Compatibilidade com a implementação

Este arquivo define o contrato aprovado para o provisionamento server-side. A
rota atualmente existente no backend ainda contém o comportamento legado de
cadastro local; ela não é evidência de que o provisionamento no Keycloak já
esteja concluído. A implementação de `hq-2e7y.3.2` deve adequar o fluxo a este
contrato, removendo a persistência local de senha e vinculando o usuário ao
identificador emitido pelo Keycloak.
