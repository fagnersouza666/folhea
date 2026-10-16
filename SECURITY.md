# Política de segurança

## Reportar uma vulnerabilidade

Use o [canal privado de vulnerabilidades do GitHub](https://github.com/fagnersouza666/folhea/security/advisories/new),
na aba **Security → Advisories → Report a vulnerability** do repositório.
O formulário depende da habilitação do reporte privado pelos administradores.
Se estiver indisponível, aguarde o restabelecimento do canal privado; não
publique o achado em issues, pull requests ou discussões públicas.

Informe a versão ou commit afetado, os passos mínimos de reprodução, o impacto
e uma prova de conceito com dados fictícios. Não envie senhas, tokens, cookies,
chaves privadas, dumps de banco ou dados pessoais. Use placeholders para
endereços, usuários, caminhos e nomes de containers da infraestrutura real.

Acompanhe a resposta e a correção pelo mesmo canal privado. Combine a divulgação
com os mantenedores antes de publicar detalhes que permitam explorar a falha.
Veja também as [orientações do GitHub para reporte privado](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately).

## Segredo exposto

**Revogue ou troque imediatamente o segredo no serviço de origem.** Invalide
credenciais e sessões afetadas quando aplicável; não espere a remoção do texto
do repositório para agir.

Apagar um arquivo, commit, log ou artifact não torna o segredo seguro novamente:
o repositório pode já ter sido clonado, e cópias, caches e backups podem existir.
A limpeza do material público não substitui a revogação ou rotação.

Depois de conter o acesso, investigue o uso indevido, corrija a origem do
vazamento e retire os valores expostos dos arquivos e artifacts públicos.
Registre apenas evidências mínimas e redigidas no canal privado, sem repetir o
segredo em issues, comentários, exemplos, testes ou listas de bloqueio.

## Conteúdo público

Não versione configurações privadas, credenciais, IPs reais, usuários do sistema,
caminhos do servidor ou nomes de containers de produção. Exemplos devem usar
placeholders ou endereços reservados para documentação (RFC5737). O domínio
público do produto, endereços de loopback e versões de dependências podem ser
documentados quando necessários para explicar o contrato do projeto.

Antes da publicação, o CD verifica metadados e todas as camadas do arquivo de
imagens, inclusive arquivos removidos em camadas posteriores. A validação do
Caddy no build usa armazenamento temporário em memória para sua PKI local;
esse material não deve entrar nas camadas publicadas. Uma falha no gate impede
o upload do arquivo de imagens. Esses controles não substituem a investigação
e a revogação de um segredo exposto.
