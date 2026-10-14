SPEC COMPLETA (SEG-02), aprovada pelo Mestre em 14/10/2026.

# SEG-02: Repositório público sem informação confidencial

Status: aprovada pelo Mestre em 14/10/2026.
Autorizada por: Diretor de Produto (13/10/2026)
Ordem: depois da FIX-02 e antes da DEPLOY-01

## Objetivo
O repo `fagnersouza666/folhea` é público. Nenhum segredo ou detalhe da infraestrutura pode entrar no código, nos docs, no histórico ou nos artifacts. Uma trava no CI precisa estar ligada antes do deploy, porque o deploy traz o token do webhook e detalhes do VPS.

## Situação hoje (13/10/2026)
- O repo já está público.
- O gitleaks rodou em todo o histórico e achou 1 caso: a senha falsa `uma-senha-segura-2026` em `PasswordHasherTest.java` (commit 1d7294b5).
- Nenhum `.env`, `.pem`, `.key` ou chave SSH está versionado.
- Os docs não têm IP público. O único número parecido com IP em `docs/relatorio-seguranca.md` é uma versão de dependência (3.33.3.2).
- Nenhum workflow usa `pull_request_target`.
- Nenhum `ARG` ou `ENV` dos Dockerfiles leva segredo.
- O CD roda só em push na main.

## O que fazer
1. Rodar a varredura de segredos (gitleaks) no CI a cada push e a cada PR, com o check obrigatório para o merge na main.
2. Criar o `.gitleaks.toml` com uma exceção só para a senha falsa do `PasswordHasherTest.java`, com um comentário explicando que ela é falsa.
3. Revisar docs, specs e `bug-report.md`. Sai IP, nome de container, caminho no VPS e usuário do sistema. O domínio pode ficar.
4. Criar o `SECURITY.md` dizendo:
   - como reportar uma falha, pelo canal privado de vulnerabilidade do GitHub;
   - que segredo vazado é trocado na hora, porque apagar do histórico não basta (o repo pode já ter sido clonado).
5. Garantir que o artifact do CD (`folhea-images.tar.gz`), que qualquer pessoa logada consegue baixar, não leva segredo: nada em `ARG` ou `ENV` no build, e o realm só é montado quando o container sobe.
6. Nos workflows, proibir `pull_request_target` e não usar secret em job que rode em PR vindo de fork.
7. Os arquivos de hook da DEPLOY-01 entram como modelo, com placeholders. O token real fica num `.env` no VPS, fora do repo, e no secret do GitHub.

## Critérios de aceite
1. Um PR de teste com um segredo falso fora da exceção falha no check do gitleaks, e o merge fica bloqueado.
2. O gitleaks em todo o histórico da main termina sem achados, contando com a exceção do item 2.
3. Uma busca em `docs/`, `docs/specs/` e `README*` não encontra IP público, nome de container de produção, caminho no VPS nem usuário do sistema.
4. O `SECURITY.md` existe na raiz, com o canal de reporte e o procedimento de trocar o segredo.
5. Nenhum Dockerfile tem segredo em `ARG` ou `ENV`. O realm continua sendo montado só quando o container sobe.
6. Nenhum workflow usa `pull_request_target`, e nenhum job disparado por PR lê `secrets.*`.
7. O hook versionado só tem placeholders.
8. Nada muda na API nem no comportamento do app.

## Fora desta spec
- Reescrever o histórico do git. O único achado é falso, e um segredo real, se algum dia vazar, se troca e não se apaga.
- Licença e textos do `NOTICE`.
- Modelo de cobrança. O Definidor de Planos registrou que, com código aberto, a cobrança seria pelo serviço hospedado.
