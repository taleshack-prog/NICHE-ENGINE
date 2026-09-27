import { z } from "zod";
import { CATEGORIAS_GANCHO } from "./domain";
import { contarPalavras } from "./utils";

/**
 * Os 4 prompts de produção + seus schemas de validação.
 *
 * Padrão de todos: instrução de sistema → regras rígidas → few-shot completo →
 * exigência de JSON puro. O few-shot é a parte que mais importa: se a saída
 * vier malformada, adicione um exemplo, não uma regra.
 *
 * Os placeholders {{x}} são substituídos por `interpolar()` — mantidos no texto
 * porque tornam o prompt legível e diffável.
 */

// ─────────────────────────────────────────────
// Interpolação
// ─────────────────────────────────────────────

/**
 * Troca {{chave}} pelos valores informados e falha se sobrar placeholder.
 * Falhar aqui é muito mais barato do que descobrir depois que a IA recebeu
 * literalmente a string "{{transcricao}}" e inventou o conteúdo.
 */
export function interpolar(
  template: string,
  vars: Record<string, string>,
): string {
  const out = template.replace(/\{\{(\w+)\}\}/g, (_m, chave: string) => {
    const valor = vars[chave];
    if (valor === undefined) {
      throw new Error(`interpolar: placeholder "{{${chave}}}" sem valor`);
    }
    return valor;
  });
  const sobrando = out.match(/\{\{(\w+)\}\}/g);
  if (sobrando) {
    throw new Error(`interpolar: placeholders não resolvidos: ${sobrando.join(", ")}`);
  }
  return out;
}

// ─────────────────────────────────────────────
// 7.1 — DECOMPOSIÇÃO DE CONTEÚDO VIRAL
// ─────────────────────────────────────────────

export const decomposeViralSchema = z.object({
  gancho: z.object({
    tipo: z.enum(CATEGORIAS_GANCHO),
    texto: z.string().min(3),
  }),
  mecanismoRetencao: z.string().min(3),
  loop: z.string().min(3),
  cta: z.string().min(3),
  padrao: z
    .string()
    .min(2)
    .refine((s) => contarPalavras(s) <= 5, {
      message: "padrao deve ter no máximo 5 palavras",
    }),
});
export type DecomposicaoViral = z.infer<typeof decomposeViralSchema>;

export const decomposeViralPrompt = `Você é analista de conteúdo viral especializado em Reels do Instagram.
Sua tarefa é decompor a transcrição de um Reel viral na sua estrutura mecânica subjacente.

REGRAS:
1. Identifique o gancho: as primeiras palavras que prendem nos primeiros 3 segundos.
   Classifique em: pergunta | negacao | numero | story | contraste.
2. Identifique o mecanismo de retenção: O QUE faz o espectador não sair
   (curiosity gap, lista prometida, tensão narrativa, prova visual, ritmo de cortes).
3. Identifique o loop: como o final conecta de volta ao início (essencial para replay).
4. Identifique o CTA real (o que o vídeo pede: salvar, compartilhar, seguir, comentar).
5. Nomeie o padrão em 2-4 palavras (ex: "lista negativa", "mito vs realidade",
   "erro comum", "antes e depois").

SAÍDA: APENAS JSON válido, sem markdown, sem comentários, neste formato:
{"gancho":{"tipo":"...","texto":"..."},"mecanismoRetencao":"...","loop":"...","cta":"...","padrao":"..."}

EXEMPLO:
ENTRADA (transcrição): "Ninguém te conta isso sobre investir em cripto. A maioria
perde dinheiro por 3 motivos, e o terceiro é o que ninguém corrige. Primeiro:
compram no topo por FOMO. Segundo: não entendem ciclos. Terceiro: vendem no
pânico exatamente quando deveriam comprar. Se você corrigir só o terceiro,
já sai da maioria. Salva esse vídeo pra lembrar na próxima queda."

SAÍDA:
{"gancho":{"tipo":"negacao","texto":"Ninguém te conta isso sobre investir em cripto"},
"mecanismoRetencao":"lista prometida de 3 itens com o terceiro sinalizado como o mais importante (curiosity gap)",
"loop":"o 'terceiro motivo' é o mesmo erro que define a maioria, fechando com o gancho de exclusividade",
"cta":"salvar o vídeo para consultar na próxima queda de mercado",
"padrao":"lista numerada com item surpresa"}

AGORA DECOMPONHA A SEGUINTE TRANSCRIÇÃO:
{{transcricao}}`;

// ─────────────────────────────────────────────
// 7.2 — GERAÇÃO DE COPY (legenda + hashtags + cover)
// ─────────────────────────────────────────────

const HASHTAGS_PROIBIDAS = ["#fyp", "#viral", "#explore", "#foryou", "#fy"];

export const gerarCopySchema = z.object({
  legenda: z
    .string()
    .min(10)
    .refine(
      (s) => {
        const primeira = s.split("\n")[0] ?? "";
        return contarPalavras(primeira) <= 12;
      },
      { message: "a primeira linha (re-gancho) deve ter no máximo 12 palavras" },
    ),
  hashtags: z
    .array(z.string().regex(/^#\S+$/, "hashtag deve começar com # e não ter espaços"))
    .min(8)
    .max(12)
    .refine(
      (tags) => !tags.some((t) => HASHTAGS_PROIBIDAS.includes(t.toLowerCase())),
      { message: `hashtags genéricas proibidas: ${HASHTAGS_PROIBIDAS.join(", ")}` },
    ),
  coverText: z
    .string()
    .min(2)
    .refine((s) => contarPalavras(s) <= 6, {
      message: "coverText deve ter no máximo 6 palavras",
    }),
});
export type CopyGerada = z.infer<typeof gerarCopySchema>;

export const gerarCopyPrompt = `Você é copywriter sênior de páginas de nicho faceless no Instagram.

REGRAS OBRIGATÓRIAS:
1. LEGENDA: a primeira linha é um RE-GANCHO — deve funcionar sozinha no feed
   (o usuário lê só ela antes do "ver mais"). Máximo 12 palavras. Depois,
   2-4 parágrafos curtos de valor denso, sem enrolação.
2. HASHTAGS: entre 8 e 12, exatamente nesta mistura:
   - 3 amplas (alto volume, genéricas do nicho)
   - 5 de nicho (específicas do tema)
   - 2 long-tail (frases compostas, baixa competição)
   Sem hashtag genérica de "viral" (#fyp, #viral, #explore são proibidas).
3. COVER TEXT: máximo 6 palavras, legível em thumbnail pequena, caixa alta.

SAÍDA: APENAS JSON válido:
{"legenda":"...","hashtags":["..."],"coverText":"..."}

EXEMPLO:
ENTRADA:
roteiro: "Por que 90% dos iniciantes em cripto perdem dinheiro: eles compram
no topo por FOMO, não entendem ciclos de mercado e vendem no pânico..."
nicho: "finanças e criptomoedas"
persona: "homem, 25-40 anos, começou a investir recentemente, medo de perder dinheiro"

SAÍDA:
{"legenda":"O erro não é comprar. É quando.\\n\\nQuem entra no topo paga o preço do entusiasmo. Quem entende ciclo paga o preço da paciência — e é bem mais barato.\\n\\nCiclo não é previsão. É contexto: onde o mercado está em relação ao próprio histórico.\\n\\nSem esse contexto, toda decisão vira reação.",
"hashtags":["#investimentos","#criptomoedas","#financas","#bitcoin","#mercadocripto",
"#educacaofinanceira","#carteiradigital","#analisedemercado","#comoinvestirsemperder",
"#criptoparainiciantes"],
"coverText":"90% PERDEM POR ISSO"}

AGORA GERE A COPY PARA:
roteiro: {{roteiro}}
nicho: {{nicho}}
persona: {{persona}}`;

// ─────────────────────────────────────────────
// 7.3 — GERAÇÃO DE ROTEIRO (3 variações)
// ─────────────────────────────────────────────

export const gerarRoteiroSchema = z.object({
  variacoes: z
    .array(
      z.object({
        templateUsado: z.string().min(2),
        gancho: z.string().min(5),
        corpo: z.string().min(20),
        loop: z.string().min(5),
        cta: z.string().min(5),
        duracaoEstimadaSeg: z.number().int().min(15).max(120),
      }),
    )
    .length(3)
    .refine(
      (vs) => new Set(vs.map((v) => v.templateUsado.toLowerCase())).size === 3,
      { message: "as 3 variações devem usar templates diferentes" },
    ),
});
export type RoteiroGerado = z.infer<typeof gerarRoteiroSchema>;
export type VariacaoRoteiro = RoteiroGerado["variacoes"][number];

export const gerarRoteiroPrompt = `Você é roteirista de Reels faceless. Gera roteiros de 30-60 segundos
para narração por voz IA sobre b-roll gerado por IA.

REGRAS OBRIGATÓRIAS:
1. ESTRUTURA FIXA de cada roteiro:
   - GANCHO (0-3s): frase que interrompe o scroll. Baseie-se nos templates
     do swipe file fornecido. NUNCA use gancho idêntico ao do post anterior.
   - CORPO: valor denso, frases curtas, uma ideia por frase. Sem "olá pessoal",
     sem introdução, sem "nesse vídeo eu vou".
   - LOOP: a última frase conecta semanticamente com a primeira, incentivando
     o replay (o algoritmo conta replays como retenção).
   - CTA: salvar ou compartilhar. NUNCA "comente X" (comentário-genérico
     atrai audiência fria de baixa qualidade).
2. GERE EXATAMENTE 3 variações, cada uma usando um TEMPLATE DIFERENTE
   do swipe file fornecido.
3. Cada frase do roteiro deve ser visualizável (o b-roll será gerado por IA).

SAÍDA: APENAS JSON válido:
{"variacoes":[{"templateUsado":"...","gancho":"...","corpo":"...","loop":"...","cta":"...","duracaoEstimadaSeg":45}]}

EXEMPLO:
ENTRADA:
tema: "por que a maioria desiste de aprender a investir no primeiro mês"
swipe file (templates):
  1. padrao "lista negativa" — gancho tipo "Ninguém te conta que..."
  2. padrao "erro comum" — gancho tipo "Se você faz isso, pare agora"
  3. padrao "contraste" — gancho tipo "Enquanto X, Y está acontecendo"
post anterior usou: gancho "Ninguém te conta..."

SAÍDA:
{"variacoes":[
{"templateUsado":"erro comum","gancho":"Se você estudou investimentos e ainda não investe, o problema é este.","corpo":"Você consumiu dezenas de vídeos. Entendeu juros compostos. Sabe o que é ETF. Mas não executa. Não é falta de conhecimento. É excesso dele. Paralisia por análise: cada vídeo novo contradiz o anterior e você volta pra estaca zero. A solução é chata: escolher UMA estratégia simples e seguir por 90 dias sem trocar.","loop":"O excesso de conteúdo que te trouxe até aqui é exatamente o que te impede de começar.","cta":"Salva esse vídeo e assiste toda vez que sentir vontade de trocar de estratégia.","duracaoEstimadaSeg":42},
{"templateUsado":"contraste","gancho":"Enquanto você estuda o investimento perfeito, o tempo composto está passando.","corpo":"Dois investidores. O primeiro começou há três anos com uma carteira medíocre. O segundo ainda está escolhendo a carteira ideal. O primeiro está na frente e vai continuar. Não porque escolheu melhor. Porque começou antes. Tempo no mercado é a única variável que você não recupera depois.","loop":"A carteira perfeita que você está montando vale menos que os três anos que ela custou.","cta":"Compartilha com quem está há meses só pesquisando.","duracaoEstimadaSeg":45},
{"templateUsado":"lista negativa","gancho":"Três coisas que ninguém avisa sobre o primeiro mês investindo.","corpo":"Primeira: o rendimento vai parecer ridículo, e é normal — um mês não mostra nada. Segunda: você vai querer conferir o saldo todo dia, e isso só treina ansiedade. Terceira: alguém vai te mostrar um retorno absurdo e você vai duvidar da sua estratégia. As três testam a mesma coisa: se você aguenta o tédio.","loop":"O primeiro mês não é sobre rendimento. É sobre descobrir se você aguenta o segundo.","cta":"Salva pra reler no fim do seu primeiro mês.","duracaoEstimadaSeg":48}
]}

AGORA GERE PARA:
tema: {{tema}}
swipe file (templates disponíveis): {{swipeFile}}
gancho do post anterior: {{ganchoAnterior}}`;

// ─────────────────────────────────────────────
// 7.4 — RELATÓRIO SEMANAL DE PERFORMANCE
// ─────────────────────────────────────────────

export const relatorioSemanalSchema = z.object({
  padroesVencedores: z.array(
    z.object({ padrao: z.string().min(2), evidencia: z.string().min(10) }),
  ),
  padroesPerdedores: z.array(
    z.object({ padrao: z.string().min(2), evidencia: z.string().min(10) }),
  ),
  hipoteses: z.array(z.string().min(10)),
  recomendacaoProximaSemana: z.string().min(20),
});
export type RelatorioSemanal = z.infer<typeof relatorioSemanalSchema>;

export const relatorioSemanalPrompt = `Você é analista de performance de conteúdo no Instagram.
Recebe as métricas da semana e produz um relatório acionável.

REGRAS:
1. Baseie CADA conclusão em dados explícitos. Se os dados não sustentam
   uma conclusão, declare a incerteza — nunca invente padrão sem evidência.
2. Métricas em ordem de importância para o algoritmo: salvamentos >
   compartilhamentos > retenção 3s > alcance > comentários > curtidas.
3. Compare posts ENTRE SI na mesma semana (relativo, não absoluto).
4. Hipóteses devem ser testáveis na próxima semana (uma variável por vez).
5. A recomendação final deve ser específica o suficiente para virar
   instrução direta de produção (ex: "priorizar padrão X, evitar horário Y").

SAÍDA: APENAS JSON válido:
{"padroesVencedores":[{"padrao":"...","evidencia":"..."}],
"padroesPerdedores":[{"padrao":"...","evidencia":"..."}],
"hipoteses":["..."],
"recomendacaoProximaSemana":"..."}

EXEMPLO:
ENTRADA (métricas da semana):
[
 {"post":"P1","padrao":"lista numerada","formato":"carrossel","alcance":12400,"salvamentos":890,"compartilhamentos":210,"retention3s":null,"follows":65},
 {"post":"P2","padrao":"pergunta provocativa","formato":"reel","alcance":8200,"salvamentos":140,"compartilhamentos":95,"retention3s":0.38,"follows":12},
 {"post":"P3","padrao":"contraste","formato":"reel","alcance":21000,"salvamentos":310,"compartilhamentos":640,"retention3s":0.61,"follows":180}
]

SAÍDA:
{"padroesVencedores":[
{"padrao":"contraste em Reel","evidencia":"P3 teve 640 compartilhamentos (3x P1) e retention3s de 61%, muito acima dos 38% de P2"},
{"padrao":"carrossel para salvamento","evidencia":"P1 gerou 890 salvamentos, o maior da semana, apesar de alcance intermediário — formato de referência tem alta taxa de guarda"}
],
"padroesPerdedores":[
{"padrao":"pergunta provocativa em Reel","evidencia":"P2 teve a pior retenção (38%) e apenas 140 salvamentos com 8.200 de alcance — o gancho em forma de pergunta não sustentou os 3s iniciais"}
],
"hipoteses":[
"Reels com estrutura de contraste retêm melhor porque o conflito aparece nos primeiros 3s — testar 2 Reels de contraste na próxima semana",
"Carrosséis convertem mais em salvamentos do que em alcance — testar carrossel com gancho de contraste para combinar os dois comportamentos"
],
"recomendacaoProximaSemana":"Produzir 2 Reels com padrão contraste e 1 carrossel com gancho de contraste. Evitar ganchos em formato de pergunta até novo teste. Publicar no mesmo horário de P3 para isolar a variável de padrão."}

AGORA ANALISE AS MÉTRICAS:
{{metricas}}`;
