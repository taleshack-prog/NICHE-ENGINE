/**
 * Seed de exemplo.
 *
 * Objetivo: abrir o dashboard e ver todas as 6 telas com dado plausível —
 * kanban com cards nas 5 colunas, calendário com agendamentos, analytics com
 * métricas suficientes (>= 3 posts) para o relatório semanal fazer sentido.
 *
 * Idempotente: usa upsert em chaves estáveis, então rodar duas vezes não
 * duplica nada.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function diaRef(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function diasAtras(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(9, 0, 0, 0);
  return d;
}

function daquiADias(n: number, hora = 19): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hora, 0, 0, 0);
  return d;
}

async function main() {
  console.log("→ semeando config…");
  for (const [chave, valor] of [
    ["meta_long_lived_token", process.env.META_LONG_LIVED_TOKEN || "SEU_TOKEN_INICIAL_AQUI"],
    ["ig_user_id", process.env.IG_USER_ID || ""],
    ["meta_graph_version", process.env.META_GRAPH_VERSION || "v21.0"],
  ] as const) {
    await prisma.config.upsert({
      where: { chave },
      create: { chave, valor },
      update: {},
    });
  }

  console.log("→ semeando nichos…");
  const cripto = await prisma.nicho.upsert({
    where: { id: "seed-nicho-cripto" },
    create: {
      id: "seed-nicho-cripto",
      nome: "Finanças e criptomoedas",
      subNicho: "erros de iniciante em cripto",
      cpmEstimado: 18.5,
      demandaPerene: 9,
      concorrencia: 8,
      score: 9 * 2 - 8 + 18.5 / 5,
      status: "ativo",
      persona:
        "homem, 25-40 anos, começou a investir recentemente, medo de perder dinheiro, consome conteúdo no celular à noite",
    },
    update: {},
  });

  const produtividade = await prisma.nicho.upsert({
    where: { id: "seed-nicho-produtividade" },
    create: {
      id: "seed-nicho-produtividade",
      nome: "Produtividade para autodidatas",
      subNicho: "estudo com pouco tempo",
      cpmEstimado: 7.2,
      demandaPerene: 8,
      concorrencia: 6,
      score: 8 * 2 - 6 + 7.2 / 5,
      status: "candidato",
      persona: "estudante ou profissional em transição, 20-35 anos, sensação de estar atrasado",
    },
    update: {},
  });

  await prisma.nicho.upsert({
    where: { id: "seed-nicho-astro" },
    create: {
      id: "seed-nicho-astro",
      nome: "Curiosidades de astronomia",
      subNicho: null,
      cpmEstimado: 3.1,
      demandaPerene: 7,
      concorrencia: 9,
      score: 7 * 2 - 9 + 3.1 / 5,
      status: "descartado",
      persona: null,
    },
    update: {},
  });

  console.log("→ semeando templates virais (swipe file)…");
  const templates = [
    {
      id: "seed-tpl-lista-negativa",
      nichoId: cripto.id,
      fonte: "https://www.instagram.com/reel/EXEMPLO1/",
      gancho: "Ninguém te conta isso sobre investir em cripto",
      padrao: "lista negativa",
      performance: 1_840_000,
      estrutura: {
        hook: "Ninguém te conta isso sobre investir em cripto",
        retention: "lista prometida de 3 itens com o terceiro sinalizado como o mais importante",
        loop: "o terceiro motivo é o mesmo erro que define a maioria",
        cta: "salvar para consultar na próxima queda",
      },
    },
    {
      id: "seed-tpl-erro-comum",
      nichoId: cripto.id,
      fonte: "https://www.instagram.com/reel/EXEMPLO2/",
      gancho: "Se você faz isso, pare agora",
      padrao: "erro comum",
      performance: 920_000,
      estrutura: {
        hook: "Se você faz isso, pare agora",
        retention: "acusação direta seguida de prova",
        loop: "o erro descrito é o que o espectador acabou de fazer",
        cta: "salvar antes da próxima operação",
      },
    },
    {
      id: "seed-tpl-contraste",
      nichoId: cripto.id,
      fonte: "https://www.instagram.com/reel/EXEMPLO3/",
      gancho: "Enquanto você estuda, o tempo composto está passando",
      padrao: "contraste",
      performance: 2_300_000,
      estrutura: {
        hook: "Enquanto X, Y está acontecendo",
        retention: "duas trajetórias comparadas lado a lado",
        loop: "o tempo perdido é o próprio custo da indecisão",
        cta: "compartilhar com quem está paralisado",
      },
    },
    {
      id: "seed-tpl-mito",
      nichoId: produtividade.id,
      fonte: "https://www.instagram.com/reel/EXEMPLO4/",
      gancho: "Estudar 4 horas por dia não é o que te falta",
      padrao: "mito vs realidade",
      performance: 410_000,
      estrutura: {
        hook: "Estudar 4 horas por dia não é o que te falta",
        retention: "quebra de expectativa seguida de substituto concreto",
        loop: "o tempo não era o problema desde o começo",
        cta: "salvar para revisar a rotina no domingo",
      },
    },
  ];

  for (const t of templates) {
    await prisma.templateViral.upsert({
      where: { id: t.id },
      create: { ...t, estrutura: JSON.stringify(t.estrutura) },
      update: {},
    });
  }

  console.log("→ semeando ganchos…");
  const ganchos = [
    { texto: "Ninguém te conta isso sobre investir em cripto", categoria: "negacao", usos: 3, vitorias: 2 },
    { texto: "Se você faz isso, pare agora", categoria: "negacao", usos: 2, vitorias: 0 },
    { texto: "Enquanto você estuda, o tempo composto está passando", categoria: "contraste", usos: 4, vitorias: 3 },
    { texto: "Três coisas que ninguém avisa sobre o primeiro mês", categoria: "numero", usos: 2, vitorias: 1 },
    { texto: "Por que 90% desiste antes do terceiro mês?", categoria: "pergunta", usos: 1, vitorias: 0 },
  ];
  for (const g of ganchos) {
    const existente = await prisma.gancho.findFirst({ where: { texto: g.texto } });
    if (!existente) await prisma.gancho.create({ data: g });
  }

  console.log("→ semeando posts (um por coluna do kanban)…");
  const posts = [
    {
      id: "seed-post-1",
      titulo: "3 erros que fazem iniciante perder dinheiro em cripto",
      formato: "carrossel",
      status: "publicado",
      templateId: "seed-tpl-lista-negativa",
      publicadoEm: diasAtras(6),
      igPostId: "SEED_IG_1",
      roteiro:
        "Ninguém te conta isso sobre investir em cripto.\n\nA maioria perde dinheiro por 3 motivos, e o terceiro é o que ninguém corrige.\n\nO terceiro motivo é o mesmo que define a maioria.\n\nSalva esse post pra lembrar na próxima queda.",
      legenda:
        "O erro não é comprar. É quando.\n\nQuem entra no topo paga o preço do entusiasmo. Quem entende ciclo paga o preço da paciência — e é bem mais barato.",
      hashtags: [
        "#investimentos",
        "#criptomoedas",
        "#financas",
        "#bitcoin",
        "#mercadocripto",
        "#educacaofinanceira",
        "#carteiradigital",
        "#analisedemercado",
        "#comoinvestirsemperder",
        "#criptoparainiciantes",
      ],
      coverText: "90% PERDEM POR ISSO",
      midia: [
        { tipo: "imagem", url: "https://placehold.co/1080x1080/0b1120/38bdf8?text=Slide+1" },
        { tipo: "imagem", url: "https://placehold.co/1080x1080/0b1120/38bdf8?text=Slide+2" },
        { tipo: "imagem", url: "https://placehold.co/1080x1080/0b1120/38bdf8?text=Slide+3" },
      ],
    },
    {
      id: "seed-post-2",
      titulo: "Enquanto você escolhe a carteira perfeita",
      formato: "reel",
      status: "publicado",
      templateId: "seed-tpl-contraste",
      publicadoEm: diasAtras(4),
      igPostId: "SEED_IG_2",
      roteiro:
        "Enquanto você estuda o investimento perfeito, o tempo composto está passando.\n\nDois investidores. O primeiro começou há três anos com uma carteira medíocre. O segundo ainda está escolhendo.\n\nA carteira perfeita vale menos que os três anos que ela custou.\n\nCompartilha com quem está há meses só pesquisando.",
      legenda: "Tempo no mercado é a única variável que você não recupera.",
      hashtags: ["#investimentos", "#financas", "#bitcoin", "#jurocomposto", "#carteiradeinvestimentos", "#educacaofinanceira", "#longoprazo", "#investidoriniciante", "#comecaragora", "#mentalidadefinanceira"],
      coverText: "O TEMPO NÃO VOLTA",
      midia: [{ tipo: "video", url: "https://placehold.co/1080x1920/0b1120/f472b6?text=Reel" }],
    },
    {
      id: "seed-post-3",
      titulo: "Por que você trava antes de fazer o primeiro aporte",
      formato: "reel",
      status: "publicado",
      templateId: "seed-tpl-erro-comum",
      publicadoEm: diasAtras(2),
      igPostId: "SEED_IG_3",
      roteiro:
        "Se você estudou investimentos e ainda não investe, o problema é este.\n\nNão é falta de conhecimento. É excesso dele.\n\nO excesso de conteúdo que te trouxe até aqui é o que te impede de começar.\n\nSalva e assiste toda vez que sentir vontade de trocar de estratégia.",
      legenda: "Paralisia por análise tem nome e tem cura chata.",
      hashtags: ["#investimentos", "#financas", "#produtividade", "#paralisiaporanalise", "#primeiroaporte", "#educacaofinanceira", "#decisaofinanceira", "#investidoriniciante", "#comoinvestirdeverdade", "#semenrolacao"],
      coverText: "VOCE SABE. NAO FAZ.",
      midia: [{ tipo: "video", url: "https://placehold.co/1080x1920/0b1120/34d399?text=Reel" }],
    },
    {
      id: "seed-post-4",
      titulo: "O que o mercado faz enquanto você espera a queda",
      formato: "reel",
      status: "agendado",
      templateId: "seed-tpl-contraste",
      agendadoPara: daquiADias(1),
      roteiro: "Enquanto você espera a queda perfeita, o mercado continua.\n\n…",
      legenda: "Esperar também é uma posição — e ela tem custo.",
      hashtags: ["#investimentos", "#criptomoedas", "#financas", "#timingdemercado", "#mercadocripto", "#educacaofinanceira", "#riscoeretorno", "#investidoriniciante", "#esperarcusta", "#estrategiadeinvestimento"],
      coverText: "ESPERAR TEM CUSTO",
      midia: [{ tipo: "video", url: "https://placehold.co/1080x1920/0b1120/fbbf24?text=Agendado" }],
    },
    {
      id: "seed-post-5",
      titulo: "Checklist antes do primeiro aporte",
      formato: "carrossel",
      status: "pronto",
      templateId: "seed-tpl-lista-negativa",
      roteiro: "Ninguém faz esse checklist e é por isso que trava.\n\n…",
      legenda: "Cinco perguntas antes de apertar o botão.",
      hashtags: ["#investimentos", "#financas", "#checklist", "#primeiroaporte", "#educacaofinanceira", "#planejamentofinanceiro", "#carteiradigital", "#investidoriniciante", "#antesdeinvestir", "#organizacaofinanceira"],
      coverText: "5 PERGUNTAS ANTES",
      midia: [
        { tipo: "imagem", url: "https://placehold.co/1080x1080/0b1120/a78bfa?text=Pronto+1" },
        { tipo: "imagem", url: "https://placehold.co/1080x1080/0b1120/a78bfa?text=Pronto+2" },
      ],
    },
    {
      id: "seed-post-6",
      titulo: "Estudar mais não é o que te falta",
      formato: "reel",
      status: "produzindo",
      templateId: "seed-tpl-mito",
      nichoAlt: true,
      roteiro: "Estudar 4 horas por dia não é o que te falta.\n\n…",
      midia: [],
    },
    {
      id: "seed-post-7",
      titulo: "Ideia: o custo invisível de trocar de estratégia",
      formato: "static",
      status: "rascunho",
      midia: [],
    },
  ] as const;

  for (const p of posts) {
    await prisma.post.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        titulo: p.titulo,
        formato: p.formato,
        status: p.status,
        nichoId: "nichoAlt" in p && p.nichoAlt ? produtividade.id : cripto.id,
        templateId: "templateId" in p ? p.templateId : null,
        roteiro: "roteiro" in p ? p.roteiro : null,
        legenda: "legenda" in p ? p.legenda : null,
        hashtags: JSON.stringify("hashtags" in p ? p.hashtags : []),
        coverText: "coverText" in p ? p.coverText : null,
        midiaPaths: JSON.stringify(p.midia),
        agendadoPara: "agendadoPara" in p ? p.agendadoPara : null,
        publicadoEm: "publicadoEm" in p ? p.publicadoEm : null,
        igPostId: "igPostId" in p ? p.igPostId : null,
      },
      update: {},
    });
  }

  console.log("→ semeando métricas (3 posts publicados = relatório habilitado)…");
  const metricas = [
    {
      postId: "seed-post-1",
      dias: 5,
      alcance: 12_400,
      impressoes: 15_900,
      salvamentos: 890,
      compartilhamentos: 210,
      comentarios: 34,
      followsGanhos: 65,
      retention3s: null,
      watchRate: null,
    },
    {
      postId: "seed-post-2",
      dias: 3,
      alcance: 21_000,
      impressoes: 28_400,
      salvamentos: 310,
      compartilhamentos: 640,
      comentarios: 51,
      followsGanhos: 180,
      retention3s: 0.61,
      watchRate: 0.47,
    },
    {
      postId: "seed-post-3",
      dias: 1,
      alcance: 8_200,
      impressoes: 9_800,
      salvamentos: 140,
      compartilhamentos: 95,
      comentarios: 12,
      followsGanhos: 12,
      retention3s: 0.38,
      watchRate: 0.29,
    },
  ] as const;

  for (const m of metricas) {
    const quando = diasAtras(m.dias);
    await prisma.metrica.upsert({
      where: { postId_dataRef: { postId: m.postId, dataRef: diaRef(quando) } },
      create: {
        postId: m.postId,
        dataRef: diaRef(quando),
        dataColeta: quando,
        alcance: m.alcance,
        impressoes: m.impressoes,
        salvamentos: m.salvamentos,
        compartilhamentos: m.compartilhamentos,
        comentarios: m.comentarios,
        followsGanhos: m.followsGanhos,
        retention3s: m.retention3s,
        watchRate: m.watchRate,
      },
      update: {},
    });
  }

  console.log("→ semeando fila de tópicos…");
  const topicos = [
    { tema: "Produzir 2 Reels com padrão contraste e 1 carrossel com gancho de contraste", prioridade: 10 },
    { tema: "Testar carrossel com gancho de contraste para combinar salvamento e alcance", prioridade: 5 },
    { tema: "O que muda quando você entende ciclo de mercado", prioridade: 3 },
  ];
  for (const t of topicos) {
    const existente = await prisma.topico.findFirst({ where: { tema: t.tema } });
    if (!existente) {
      await prisma.topico.create({
        data: { tema: t.tema, nichoId: cripto.id, prioridade: t.prioridade, status: "pendente" },
      });
    }
  }

  const contagem = {
    nichos: await prisma.nicho.count(),
    templates: await prisma.templateViral.count(),
    posts: await prisma.post.count(),
    metricas: await prisma.metrica.count(),
    ganchos: await prisma.gancho.count(),
    topicos: await prisma.topico.count(),
  };
  console.log("✓ seed concluído:", contagem);
}

main()
  .catch((e) => {
    console.error("✗ seed falhou:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
