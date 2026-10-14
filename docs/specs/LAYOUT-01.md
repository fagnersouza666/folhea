SPEC COMPLETA (LAYOUT-01), aprovada pelo Mestre em 14/10/2026.

# LAYOUT-01: Uso com uma mão no celular (início, livro, registrar sessão)

Status: aprovada pelo Mestre em 14/10/2026.
Origem: pedido do Mestre (12/10/2026), escopo do Diretor, limites técnicos do Arquiteto, mapa em 360x640 (`/workspace/folhea-layout/MAPA.md`)
Não trava: deploy da 0.6.0. Entra na versão seguinte.

## Escopo
Só três telas: início, livro e registrar sessão. Não entra tela nova, função nova nem redesenho da marca. O objetivo é que dê para usar com uma mão num celular de 360 px de largura, no navegador e no app instalado (PWA).

## Limites técnicos (Arquiteto)
- Sem biblioteca de componentes nova. Fica o Tailwind 4 com as variáveis de CSS de hoje.
- As medidas de toque e de espaçamento viram variáveis de CSS, por exemplo `--tap-min: 44px`, e não ficam como números soltos em cada regra.
- Modo app instalado: `viewport-fit=cover` no `index.html`, e o topo, as laterais e o rodapé usam `env(safe-area-inset-*)`.
- A altura da tela usa `100dvh` no lugar de `100vh` (`styles.css:56` e as outras telas que usam `100vh`).
- Os campos de formulário têm pelo menos 16 px de fonte, para o iPhone não dar zoom ao tocar. Os campos de número continuam com `inputmode="numeric"`.

## O que muda em cada tela

### Comum às três telas
1. Cabeçalho: os botões de configurações e de perfil/Sair passam a ter pelo menos 44x44 px. O "Sair" deixa de ter 10 px de fonte.
2. Links de voltar ("← Início", "← Seus livros") passam a ter área de toque de pelo menos 44 px de altura.
3. Nenhum conteúdo nem botão fica escondido atrás da barra de baixo fixa. O fim da página ganha um espaço igual à altura da barra mais a área segura.

### Registrar sessão
4. Em 360x640, com o livro já escolhido, o botão de salvar fica sempre visível, preso no fim do formulário com `position: sticky` acima da barra de baixo (não `position: fixed` na tela). Decidido pelo Diretor e pelo Arquiteto em 13/10/2026.
5. Os campos Páginas e Minutos aparecem na primeira tela, sem ficar atrás da barra.
6. O bloco de capa e progresso e o texto de introdução não podem empurrar o formulário para fora da primeira tela. A forma de resolver (diminuir, recolher ou mover para baixo do botão) fica com quem implementar, desde que os critérios 4 e 5 passem.

### Livro
7. "Registrar leitura" vira o botão principal da tela e aparece sem rolar, em 360x640.
8. O formulário de editar o livro deixa de ocupar a primeira tela. Ele continua na página, abaixo das informações e do progresso, ou atrás de um botão "Editar". Os campos e as regras não mudam.
9. O campo de capa deixa de mostrar o botão nativo do navegador, em inglês ("Choose File"). Ele vira um botão em português com pelo menos 44 px de altura, sem mudar o que a foto aceita.

### Início
10. Os links "Ver progresso" e "Criar um card com seu progresso" passam a ter pelo menos 44 px de altura de toque, e "Ver progresso" não fica atrás da barra de baixo.
11. O botão "Registrar leitura" continua onde está, que já é na metade de baixo da tela e sem precisar rolar.

## Critérios de aceite
1. Nenhuma das três telas tem rolagem lateral em 360x640, no modo de celular do navegador e no app instalado.
2. Em 360x640, todo alvo de toque das três telas (botões, links e campos) tem pelo menos 44x44 px. Rótulos de texto de formulário não contam.
3. Todos os campos das três telas têm fonte de pelo menos 16 px.
4. O `index.html` tem `viewport-fit=cover`, nenhuma das três telas usa `100vh`, e o topo e o rodapé respeitam a área segura no app instalado em iPhone.
5. Do início até uma sessão salva, com o livro já escolhido, são no máximo 3 toques e nenhuma rolagem, sem contar a digitação.
6. Na tela do livro, o "Registrar leitura" aparece sem rolar.
7. As medidas de toque e de espaçamento usadas nas três telas vêm de variáveis de CSS.
8. Um teste Playwright em 360x640 confere os critérios 1, 2, 3, 5 e 6 nas três telas. Pode partir do script em `/workspace/folhea-layout/map.spec.ts`.
9. Nada muda na API, nas regras dos formulários ou nos textos fora dos botões e links citados.
10. Com o teclado aberto no campo Minutos, o campo e o botão salvar continuam visíveis. Teste do Mestre no Galaxy com o app instalado.

## Fora desta spec
- As outras telas (configurações, login, páginas públicas, 404), mesmo as que usam `100vh`.
- Tema escuro, marca, cores e ícones.
- Verificação: o Avaliador confere os critérios 1, 2, 3, 5 e 6 no ar, em Chromium com 360x640. O app instalado é testado pelo Mestre no celular dele, um Android. Sem um iPhone, a área segura e o zoom no iOS entram no aceite como "não verificado".
