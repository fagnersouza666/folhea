# Contrato de erros do cadastro

Referência: `hq-2e7y.3.1.2` / `fo-5ny`.

Este documento define a projeção pública das falhas do cadastro. O cadastro é
processado pelo backend: o navegador nunca chama a API administrativa do
Keycloak. O sucesso só pode ser informado depois de o provisionamento no
Keycloak e a associação do usuário local ao `sub` terem sido confirmados.

## Forma pública

Toda falha do endpoint de cadastro deve ser uma resposta RFC 7807 com
`Content-Type: application/problem+json` e `Cache-Control: no-store`:

```json
{
  "type": "https://folhea.com.br/problems/registration-unavailable",
  "title": "Cadastro não disponível",
  "status": 409,
  "detail": "Não foi possível concluir o cadastro."
}
```

Os clientes devem tomar decisões por `status` e `type` estáveis. `title` e
`detail` são texto de apresentação e não podem ser usados para inferir a causa
interna. Nenhuma resposta pública inclui senha, token, mensagem do Keycloak,
exceção, stack trace, nome de constraint, e-mail recebido ou identificador de
correlação.

## Matriz de classificação

| Situação | Resposta pública | Estado do formulário |
| --- | --- | --- |
| Corpo ausente ou JSON inválido | `400`, `https://folhea.com.br/problems/invalid-request`, mensagem genérica de requisição inválida | `validation_error` |
| E-mail ausente, inválido ou fora do limite; senha ausente ou fora da política publicada | `400`, `https://folhea.com.br/problems/invalid-registration`, mensagem orientada à correção, sem repetir o valor informado | `validation_error` |
| Validação de credencial rejeitada pelo Keycloak | `400`, `https://folhea.com.br/problems/invalid-registration`, mensagem genérica de dados inválidos; nunca repassar a política ou o texto bruto do provedor | `validation_error` |
| E-mail/identificador já existente no Keycloak | `409`, `https://folhea.com.br/problems/registration-unavailable`, `Não foi possível concluir o cadastro.` | `conflict_error` |
| Usuário ou identificador já associado localmente, inclusive corrida de inserção protegida por constraint única | `409`, o mesmo `type`, `title` e `detail` do conflito no Keycloak | `conflict_error` |
| Keycloak indisponível, timeout, resposta 5xx ou falha de autenticação/configuração administrativa | `503`, `https://folhea.com.br/problems/registration-unavailable`, `Não foi possível concluir o cadastro. Tente novamente mais tarde.` | `provider_error` |
| Provisionamento confirmado, mas associação local falhou | `503`, o mesmo `type`, `title` e `detail` da indisponibilidade operacional | `provider_error` |
| Resultado do provisionamento ou da compensação não pôde ser confirmado | `503`, o mesmo `type`, `title` e `detail` da indisponibilidade operacional | `provider_error` |
| Falha inesperada sem classificação segura | `500`, `https://folhea.com.br/problems/internal-error`, `Não foi possível concluir a operação.` | `provider_error` |

Conflitos de fontes diferentes usam a mesma resposta para evitar enumeração de
contas. Falhas do provedor e da associação local também compartilham a mesma
projeção pública: o cliente não precisa saber em que etapa interna a operação
falhou.

Uma proteção de abuso ou limite de requisições pode responder `429` conforme o
contrato geral de segurança. Ela deve manter `problem+json`, não revelar se o
identificador existe e não ser convertida em uma mensagem do Keycloak.

## Regras de processamento

1. Validar e normalizar os campos antes de chamar o provedor. Senhas são
   mantidas apenas na memória durante a chamada server-side e nunca são
   persistidas ou registradas em log pelo Folhea.
2. Fazer a verificação de duplicidade no Keycloak e no banco local. A resposta
   de conflito deve ser igual para uma duplicidade detectada antes da chamada e
   para uma corrida descoberta pela constraint única.
3. Mapear respostas do Keycloak por categoria controlada. Somente rejeições de
   dados conhecidas podem virar `400`; conflitos conhecidos viram `409`; erros
   de rede, autenticação administrativa, formato inesperado e respostas 5xx
   viram a falha operacional genérica.
4. Depois de criar um usuário no Keycloak, persistir a associação local usando
   exclusivamente o `sub` retornado pelo provedor. Não usar o e-mail como
   identidade substituta.
5. Se a associação local falhar depois de um provisionamento confirmado,
   tentar uma compensação server-side apagando somente o usuário criado nesta
   operação e somente pelo identificador retornado pelo Keycloak. Nunca apagar
   por e-mail e nunca apagar um usuário quando o identificador da criação for
   incerto.
6. Se a compensação falhar ou o resultado ficar ambíguo, responder com a mesma
   falha operacional genérica, registrar apenas uma categoria técnica segura e
   encaminhar o caso para reconciliação. Não responder sucesso e não expor a
   falha de compensação ao navegador.
7. Não repetir indefinidamente uma criação após timeout. Retentativas devem
   respeitar o mecanismo de idempotência/reconciliação definido pela camada de
   integração; um novo envio nunca pode apagar ou substituir uma conta de
   terceiro.

## Regras para o cliente

- `400` mantém o formulário aberto e associa a mensagem ao campo quando isso
  for seguro; a resposta bruta não é renderizada.
- `409` mostra somente a mensagem genérica de cadastro não concluído, sem usar
  expressões como “e-mail já cadastrado”, “usuário encontrado” ou equivalentes.
- `500` e `503` entram em `provider_error` e permitem nova tentativa sem
  apresentar detalhes técnicos.
- Ausência de resposta HTTP entra em `network_error`; a operação não deve ser
  tratada como concluída.
- Qualquer status, `type` ou corpo desconhecido é tratado como falha segura,
  nunca como sucesso.

## Critérios de segurança verificáveis

- `detail` e `title` não variam com a existência de uma conta nem reproduzem
  mensagens recebidas do Keycloak ou do banco.
- As respostas de conflito são indistinguíveis entre duplicidade no provedor,
  duplicidade local e corrida de persistência.
- Falhas de provisionamento e de associação local não expõem a etapa interna,
  credenciais administrativas, tokens ou dados de banco.
- Só há estado `success` após a confirmação conjunta do usuário no Keycloak e
  do vínculo local ao `sub`.
- Logs e métricas podem registrar a categoria operacional e o resultado da
  compensação, mas nunca senha, token, corpo bruto da requisição ou resposta
  bruta do provedor.
