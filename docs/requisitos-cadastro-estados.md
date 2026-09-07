# Estados do formulário de cadastro

Referência: `hq-2e7y.2.1.2` / `fo-4fd`.

Este documento registra apenas o que foi aprovado para o fluxo de cadastro:

- o cadastro provisiona o usuário no Keycloak;
- o login posterior reutiliza o fluxo Keycloak/OIDC existente;
- o usuário local é vinculado ao `sub` emitido pelo provedor.

O formulário não deve criar um fluxo de login local paralelo nem expor
credenciais, tokens, detalhes do Keycloak ou informações que permitam inferir
se um e-mail já possui conta.

## Máquina de estados

| Estado | Entrada | Comportamento permitido | Próximos estados |
| --- | --- | --- | --- |
| `idle` | Abertura da tela ou retorno após falha | Formulário disponível para edição e envio quando os campos forem válidos | `submitting`, `validation_error` |
| `submitting` | Envio localmente válido | Uma única requisição em andamento; o controle de envio não pode iniciar uma segunda requisição; não mostrar senha ou resposta bruta | `success`, `conflict_error`, `provider_error`, `network_error` |
| `validation_error` | Campo inválido ou resposta de validação | Permanecer no formulário, associar o erro ao campo afetado quando possível e permitir correção | `idle`, `submitting` |
| `success` | Keycloak confirmou o provisionamento e o vínculo local foi concluído | Informar conclusão sem expor dados sensíveis e oferecer a continuação pelo login OIDC existente | `idle` ou fluxo OIDC, conforme destino pós-cadastro aprovado |
| `conflict_error` | O provedor ou a API recusou o cadastro por conflito | Usar mensagem genérica; não confirmar nem negar a existência de conta; manter o formulário recuperável | `idle`, `submitting` |
| `provider_error` | Falha segura do Keycloak, da API ou do vínculo local | Usar mensagem genérica de operação; não renderizar detalhes técnicos; permitir nova tentativa | `idle`, `submitting` |
| `network_error` | Sem resposta ou falha de conexão | Informar que a operação não foi confirmada e permitir tentar novamente; não tratar a operação como concluída | `idle`, `submitting` |

## Regras de transição

1. O estado `submitting` só começa depois da validação local.
2. Enquanto `submitting` estiver ativo, novas tentativas do mesmo formulário não
   devem criar requisições concorrentes.
3. Só entrar em `success` após confirmação conjunta do provisionamento no
   Keycloak e do vínculo do usuário local ao `sub`.
4. Qualquer resposta não reconhecida como sucesso deve ser tratada como falha
   segura e manter o usuário capaz de corrigir ou tentar novamente.
5. Uma falha não deve limpar silenciosamente o formulário nem redirecionar para
   a área autenticada.
6. O login após o sucesso deve passar pelo ponto de entrada OIDC já existente;
   o destino final e a cópia da confirmação ainda não foram aprovados.

## Mensagens e privacidade

As mensagens devem comunicar somente a ação necessária ao usuário:

- validação: problema no campo e como corrigi-lo;
- conflito: cadastro não concluído, sem revelar se o identificador já existe;
- falha de provedor/API: não foi possível concluir a operação;
- rede: a operação não foi confirmada e pode ser tentada novamente;
- sucesso: cadastro concluído e próximo passo pelo login existente.

Não são mensagens permitidas na interface: exceções, stack traces, códigos de
falha do Keycloak, tokens, senha, correlation IDs, detalhes de banco ou qualquer
texto que confirme a existência de uma conta para um e-mail informado.

## Pendências que não devem ser inventadas

- texto literal do loading;
- texto literal do sucesso;
- destino exato depois do sucesso (permanecer no formulário, `/entrar` ou
  início do OIDC);
- política de limpeza/preservação dos campos após falha ou sucesso;
- cópia literal e regras detalhadas de cada validação de campo.

Esses itens precisam de decisão de produto antes de serem fixados na interface
ou nos testes de conteúdo.
