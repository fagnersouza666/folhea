# Especificação do formulário de cadastro

**Status:** pronta para implementação da tela; o contrato server-side está em
[Contrato server-side do cadastro no Keycloak](../api/registration-keycloak-contract.md)
e as pendências de produto permanecem explicitamente registradas
**Fonte da decisão:** `hq-2e7y.1` / `hq-2e7y.2.1.1`
**Escopo:** formulário público que solicita a criação de uma conta no Keycloak

## Decisão aprovada

- O site deve oferecer uma entrada para cadastro e abrir este formulário.
- O cadastro deve permitir a criação de usuário com senha.
- O formulário deve provisionar o usuário no Keycloak.
- O login posterior não será implementado como uma verificação local de
  credenciais: deve reutilizar o fluxo Keycloak/OIDC existente.
- Depois da autenticação, a aplicação vincula o usuário local ao `subject`
  emitido pelo provedor.

## Campos aprovados

| Campo | Obrigatoriedade | Formato e validação da tela | Autocomplete | Observações |
| --- | --- | --- | --- | --- |
| E-mail | Obrigatório | `input type="email"`; rejeitar vazio e formato de e-mail inválido; o limite máximo deve respeitar o contrato da API | `email` | É o identificador usado para o cadastro/login no Keycloak. Não usar nome, telefone ou outro identificador sem nova decisão. |
| Senha | Obrigatório | `input type="password"`; rejeitar vazio; aplicar apenas a política de senha publicada pelo contrato do Keycloak/API | `new-password` | Nunca exibir, registrar em log ou persistir a senha na aplicação Folhea. |

Não há aprovação para campo de confirmação de senha. A tela não deve adicionar
`confirmPassword`, nome, telefone, aceite de termos, timezone, avatar ou qualquer
outro campo até que exista uma decisão de produto correspondente.

## Regras de comportamento

1. Os dois campos devem ter rótulos visíveis, instrução suficiente para uso por
   teclado e associação correta entre rótulo, controle e mensagem de erro.
2. A validação local deve ocorrer antes do envio sempre que possível. A API ou
   Keycloak permanece a autoridade final para validação.
3. Enquanto o cadastro estiver sendo enviado, a tela deve informar carregamento e
   impedir reenvio acidental/duplicado.
4. Erros devem ser apresentados em linguagem compreensível, sem revelar senha,
   token, detalhes internos ou dados sensíveis.
5. A resposta de sucesso deve informar claramente o próximo passo. O destino
   pós-cadastro ainda não foi decidido; ver pendências abaixo.
6. A tela deve permanecer utilizável por teclado e tecnologias assistivas, com
   foco/mensagens de erro operáveis sem depender apenas de cor.
7. O envio deve ocorrer somente pelo canal seguro e pelo contrato de integração
   aprovado para provisionamento no Keycloak. A tela não deve consultar tabelas
   internas do Keycloak nem implementar autenticação local concorrente.

## Pendências que bloqueiam decisões de implementação

Estas regras não foram aprovadas na decisão de requisitos e não devem ser
inferidas pela implementação:

- política exata de senha: comprimento mínimo/máximo, composição, verificação de
  senhas comprometidas e mensagens correspondentes;
- normalização/canonicalização do e-mail e regra de comparação para duplicidade;
- comportamento e texto para e-mail já cadastrado, sem permitir enumeração de
  contas;
- confirmação de endereço de e-mail antes do login, incluindo prazo e reenvio;
- mensagem e destino após sucesso (login automático, redirecionamento para login
  ou outra tela);
- tratamento de falhas do Keycloak, indisponibilidade e limite de tentativas;
- indicação explícita de termos/política de privacidade no cadastro;
- destino pós-cadastro e política de erro permanecem sujeitos às decisões
  registradas em [Estados do formulário de cadastro](../requisitos-cadastro-estados.md).

Até que essas pendências sejam decididas, a tela deve manter o escopo mínimo de
e-mail + senha, usar mensagens genéricas e delegar as regras de credencial ao
Keycloak/API.

## Critérios de aceite da tela

- Existe uma entrada de navegação para o cadastro.
- O formulário exibe somente os campos aprovados, com indicação de
  obrigatoriedade.
- E-mail vazio ou inválido e senha vazia são sinalizados antes do envio.
- O envio informa progresso e não permite submissões duplicadas.
- Sucesso e erro são compreensíveis e não expõem dados sensíveis.
- O formulário funciona com teclado e tecnologias assistivas.
- O fluxo de login não cria uma verificação local de senha: após o cadastro, ele
  continua usando Keycloak/OIDC.
