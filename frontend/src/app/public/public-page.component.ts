import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { SeoService } from '../core/services/seo.service';

interface ContentBlock {
  title: string;
  text: string;
  items?: string[];
}

interface PublicPage {
  title: string;
  description: string;
  heading: string;
  intro: string;
  updated?: string;
  blocks: ContentBlock[];
}

export const publicPages: Record<string, PublicPage> = {
  'como-funciona': {
    title: 'Como funciona — Folhea',
    description: 'Entenda como o Folhea transforma leitura física em progresso visível.',
    heading: 'Seu hábito em três movimentos.',
    intro: 'Registrar uma leitura leva poucos segundos. O resto é deixar o progresso te acompanhar.',
    blocks: [
      { title: '1. Leia do seu jeito', text: 'Escolha o livro que está na sua mesa e leia no seu ritmo, sem metas que pesem. O Folhea acompanha a sua rotina em vez de ditar como ela deve ser.' },
      { title: '2. Registre o essencial', text: 'Informe páginas, minutos e a data. Páginas ou tempo: pelo menos um já basta para guardar a sessão e manter sua história visível.' },
      { title: '3. Continue a história', text: 'Veja seu streak e suas métricas crescerem a cada sessão. Pequenos registros tornam o próximo dia mais fácil de começar.' }
    ]
  },
  recursos: {
    title: 'Recursos — Folhea',
    description: 'Conheça os recursos do Folhea para registrar leituras e acompanhar seu progresso.',
    heading: 'Tudo o que ajuda você a continuar.',
    intro: 'Uma experiência enxuta para quem quer enxergar o hábito, sem transformar leitura em planilha.',
    blocks: [
      { title: 'Registro rápido', text: 'Um formulário simples, otimizado para celular e para voltar ao livro em menos de dez segundos. Registre páginas, minutos ou os dois.' },
      { title: 'Progresso claro', text: 'Streak, páginas, tempo e livros finalizados aparecem onde você precisa deles, com períodos de hoje, sete dias, trinta dias e todo o período.' },
      { title: 'Cards de conquista', text: 'Transforme uma boa semana de leitura em um card vertical, pronto para guardar ou compartilhar quando quiser.' },
      { title: 'Para a leitura real', text: 'O Folhea não exige ISBN, foto do livro ou uma rotina perfeita. Basta escolher um livro e registrar o que você leu.' }
    ]
  },
  sobre: {
    title: 'Sobre — Folhea',
    description: 'Conheça o propósito do Folhea, um companheiro simples para hábitos de leitura.',
    heading: 'Leitura física merece progresso visível.',
    intro: 'O Folhea nasceu para tornar o hábito de ler mais presente: menos controle, mais percepção.',
    blocks: [
      { title: 'Nosso princípio', text: 'Cada página conta. O que importa é criar um registro que incentive o próximo dia, sem transformar um momento de leitura em obrigação.' },
      { title: 'Feito para continuar', text: 'O produto combina um registro objetivo com uma visão acolhedora do progresso. Você escolhe o ritmo; o Folhea ajuda a perceber a constância.' },
      { title: 'Fale com a gente', text: 'Encontrou um problema ou quer contar como está usando o Folhea? Envie uma mensagem para oi@folhea.com.br.' }
    ]
  },
  privacidade: {
    title: 'Privacidade — Folhea',
    description: 'Saiba quais dados o Folhea coleta, como os utiliza e quais são seus direitos.',
    heading: 'Privacidade é parte do produto.',
    intro: 'Esta política explica, em linguagem simples, como tratamos os dados necessários para oferecer o Folhea.',
    updated: 'Última atualização: 6 de setembro de 2026',
    blocks: [
      { title: '1. Dados que você fornece', text: 'Para criar e proteger sua conta, podemos tratar seu e-mail e os dados de autenticação. Para mostrar seu progresso, tratamos os dados que você escolhe registrar:', items: ['livros, autores e status de leitura;', 'sessões de leitura, com data, páginas e minutos;', 'preferências necessárias para apresentar o serviço.'] },
      { title: '2. Como usamos os dados', text: 'Usamos essas informações para autenticar você, salvar seus registros, calcular métricas e melhorar a experiência do produto. Não usamos seus registros para publicidade personalizada.' },
      { title: '3. Seus registros pertencem a você', text: 'O Folhea não publica sua biblioteca ou seu histórico de leitura. Cards de conquista só são compartilhados quando você escolhe baixá-los ou usar o recurso de compartilhamento do seu dispositivo.' },
      { title: '4. Segurança e retenção', text: 'Aplicamos controles técnicos para reduzir riscos de acesso indevido e mantemos os dados enquanto sua conta for necessária para o serviço ou enquanto houver obrigação legal. Você pode baixar uma cópia dos seus dados ou excluir sua conta diretamente em Configurações; cópias de backup podem permanecer por um período limitado conforme nossa rotina operacional.' },
      { title: '5. Seus direitos', text: 'Você pode pedir confirmação de tratamento, acesso, correção ou exclusão dos seus dados, além de esclarecer dúvidas sobre esta política. O acesso e a exportação estão disponíveis em Configurações; para outros pedidos, fale conosco pelo e-mail oi@folhea.com.br.' },
      { title: '6. Atualizações', text: 'Podemos atualizar esta política quando o produto ou a legislação mudar. A data no topo indica a versão mais recente.' }
    ]
  },
  termos: {
    title: 'Termos — Folhea',
    description: 'Leia os termos de uso do Folhea e as responsabilidades ao utilizar o serviço.',
    heading: 'Termos de uso.',
    intro: 'Ao usar o Folhea, você encontra um espaço simples para registrar e acompanhar sua leitura.',
    updated: 'Última atualização: 6 de setembro de 2026',
    blocks: [
      { title: '1. O serviço', text: 'O Folhea oferece ferramentas para registrar livros e sessões de leitura, visualizar métricas e criar cards de conquista. O serviço pode evoluir, ganhar recursos ou mudar de endereço para continuar útil.' },
      { title: '2. Sua conta', text: 'Você é responsável pelas informações fornecidas e por manter seus dados de acesso em segurança. Não compartilhe sua conta nem tente acessar dados de outra pessoa.' },
      { title: '3. Seus conteúdos', text: 'Você mantém a responsabilidade pelos livros, textos e demais informações que registra. O uso do Folhea não transfere a propriedade desses dados para nós.' },
      { title: '4. Uso aceitável', text: 'Use o serviço de forma legítima, sem tentar interromper seu funcionamento, explorar vulnerabilidades, inserir conteúdo malicioso ou violar direitos de terceiros.' },
      { title: '5. Disponibilidade', text: 'Trabalhamos para manter o Folhea disponível e seguro, mas não prometemos funcionamento ininterrupto. Podemos realizar manutenção ou suspender uma operação para corrigir riscos.' },
      { title: '6. Privacidade e contato', text: 'O tratamento de dados segue a Política de privacidade. Em caso de dúvida sobre estes termos, escreva para oi@folhea.com.br.' }
    ]
  }
};

@Component({
  selector: 'folhea-public-page',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main-content">Pular para o conteúdo</a>
    <header class="public-header container">
      <a class="brand" routerLink="/" aria-label="Folhea, início"><span class="brand-mark">F</span><span>folhea</span></a>
      <nav aria-label="Navegação pública">
        <a routerLink="/como-funciona" routerLinkActive="active">Como funciona</a>
        <a routerLink="/recursos" routerLinkActive="active">Recursos</a>
        <a routerLink="/sobre" routerLinkActive="active">Sobre</a>
        <a routerLink="/entrar" class="header-login">Entrar</a>
      </nav>
    </header>
    <main id="main-content" class="public-page container">
      <p class="eyebrow">Folhea</p>
      <h1>{{ page.heading }}</h1>
      <p class="intro">{{ page.intro }}</p>
      @if (page.updated) { <p class="updated">{{ page.updated }}</p> }
      <section class="content-blocks" [attr.aria-label]="page.heading">
        @for (block of page.blocks; track block.title) {
          <article class="surface content-block">
            <h2>{{ block.title }}</h2>
            <p>{{ block.text }}</p>
            @if (block.items) {
              <ul>
                @for (item of block.items; track item) { <li>{{ item }}</li> }
              </ul>
            }
          </article>
        }
      </section>
      <a routerLink="/" class="text-link">← Voltar para o início</a>
    </main>
    <footer class="public-footer container">
      <a class="brand" routerLink="/" aria-label="Folhea, início"><span class="brand-mark">F</span><span>folhea</span></a>
      <span>© 2026 Folhea</span>
      <nav aria-label="Links legais"><a routerLink="/privacidade">Privacidade</a> · <a routerLink="/termos">Termos</a></nav>
    </footer>
  `,
  styles: [`
    :host { display:block; min-height:100vh; background:var(--cream-100); }
    .public-header { display:flex; align-items:center; justify-content:space-between; padding-block:1.2rem; }
    .public-header nav { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:1.1rem; color:var(--muted); font-size:.86rem; font-weight:650; }
    .public-header nav a { text-underline-offset:4px; }
    .public-header nav a:hover, .public-header nav a.active { color:var(--forest-900); text-decoration:underline; text-decoration-color:#a6c5b7; }
    .header-login { border:1px solid #cbd8d1; border-radius:99px; padding:.55rem .9rem; color:var(--forest-900); }
    .public-header nav .header-login { text-decoration:none; }
    .public-page { max-width:60rem; padding-block:4rem 6rem; }
    .public-page h1 { max-width:44rem; margin:.7rem 0 1.2rem; color:var(--forest-950); font-family:Georgia,serif; font-size:clamp(2.8rem,8vw,5.2rem); line-height:.98; letter-spacing:-.055em; }
    .intro { max-width:38rem; margin:0; color:var(--muted); font-size:1.15rem; line-height:1.65; }
    .updated { margin:1rem 0 0; color:var(--muted); font-size:.8rem; }
    .content-blocks { display:grid; gap:1rem; margin:3rem 0; }
    .content-block { padding:1.5rem; }
    .content-block h2 { margin:0 0 .55rem; color:var(--forest-950); font-family:Georgia,serif; font-size:1.45rem; }
    .content-block p, .content-block li { color:var(--muted); line-height:1.65; }
    .content-block p { margin:0; }
    .content-block ul { display:grid; gap:.45rem; margin:1rem 0 0; padding-left:1.2rem; }
    .text-link { color:var(--forest-800); font-weight:750; text-decoration:underline; text-underline-offset:4px; }
    .public-footer { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:1rem; padding-block:1.4rem; border-top:1px solid #dce2d9; color:var(--muted); font-size:.78rem; }
    .public-footer .brand { color:var(--forest-900); font-size:1rem; }
    .public-footer a { text-decoration:underline; text-underline-offset:3px; }
    @media (max-width:600px) { .public-header { align-items:flex-start; gap:1rem; } .public-header nav { gap:.65rem .8rem; font-size:.78rem; } .public-header nav a:nth-child(-n+3) { display:none; } }
  `]
})
export class PublicPageComponent {
  readonly page = publicPages[inject(ActivatedRoute).snapshot.data['page'] as string] ?? publicPages['sobre'];

  constructor() {
    const routeKey = inject(ActivatedRoute).snapshot.data['page'] as string;
    inject(SeoService).update(this.page.title, this.page.description, `/${routeKey}`);
  }
}
