import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { IAIndisponivelError, MODELO_PADRAO } from "@/lib/ai";
import { PASTA_PAUTAS } from "@/lib/niche";

/**
 * Rascunho de pauta por IA — a ÚNICA parte paga do dashboard do canal.
 *
 * Todo o resto (linter, régua de tempo, montagem, mistura) é código
 * determinístico e custa zero. Esta chamada é separada, explícita e com a
 * conta na tela: é a diferença entre uma ferramenta que você decide usar e uma
 * que consome crédito toda vez que você abre a página.
 */

export type Uso = {
  entrada: number;
  saida: number;
  modelo: string;
  usd: number | null;
};

/**
 * O preço NÃO vem embutido.
 *
 * Tabela de preço envelhece e, cravada no repositório, mente com cara de
 * número oficial — e o preço do seu contrato pode não ser o da tabela
 * (cache, batch, desconto). O dashboard mostra sempre os TOKENS, que são
 * exatos; o dólar aparece quando você define o preço no .env:
 *
 *   ANTHROPIC_PRECO_ENTRADA_USD=...   # por milhão de tokens
 *   ANTHROPIC_PRECO_SAIDA_USD=...
 *
 * Os valores correntes estão em platform.claude.com/docs/en/about-claude/pricing.
 */
export function precoConfigurado(): { entrada: number; saida: number } | null {
  const e = Number(process.env.ANTHROPIC_PRECO_ENTRADA_USD);
  const s = Number(process.env.ANTHROPIC_PRECO_SAIDA_USD);
  if (!Number.isFinite(e) || !Number.isFinite(s) || e <= 0 || s <= 0) return null;
  return { entrada: e, saida: s };
}

function emDolar(entrada: number, saida: number): number | null {
  const p = precoConfigurado();
  if (!p) return null;
  return (entrada * p.entrada + saida * p.saida) / 1_000_000;
}

/**
 * Estimativa de tokens antes de gastar.
 *
 * ~4 caracteres por token é a regra de bolso para texto latino; erra para
 * mais ou para menos uns 15%, e por isso a tela chama isso de estimativa e
 * mostra o número REAL depois, que vem do campo usage da resposta.
 */
export function estimar(prompt: string, saidaEsperada = 2600): Uso {
  const entrada = Math.ceil(prompt.length / 4);
  return {
    entrada,
    saida: saidaEsperada,
    modelo: modelo(),
    usd: emDolar(entrada, saidaEsperada),
  };
}

function modelo(): string {
  return process.env.ANTHROPIC_MODEL_ROTEIRO || MODELO_PADRAO.roteiro;
}

const REGRAS = `
REGRAS QUE O LINTER APLICA — uma pauta que as viole é RECUSADA antes de montar:

1. ÂNGULO. O campo \`angulo\` afirma o que o episódio DIZ, não o assunto de que
   trata. "Os quatro pilares do projeto" é tema e reprova; "dos quatro, só um
   tem meta-análise por trás" é ângulo. Precisa de contraste ou causa.

2. FALA CORRIDA. Cada bloco é UMA RESPIRAÇÃO, escrita como se lê em voz alta.
   As barras marcam onde a LEGENDA corta — não onde a frase termina. Por isso
   um corte quase nunca começa com maiúscula nem termina em ponto: ele cai no
   meio da respiração. Os blocos emendam uns nos outros ("E...", "Mas...",
   "Por isso...", "Tanto que..."). Nenhuma legenda pode passar de 4 linhas na
   tela (cerca de 10 palavras).

3. PRODUTO. O que o projeto já entrega vai no presente. O que é roadmap TEM de
   vir marcado na própria fala ("que ainda não existe", "é o próximo passo").

4. FONTE. Todo bloco que afirme um número — em dígito ou por extenso — precisa
   do campo \`fonte\` apontando para uma fonte declarada. Número do próprio
   projeto usa \`fonte: produto\`.

5. NADA DE TEXTO DE MODELO: "escreva aqui", "a definir", "pedaço da fala".

VISUAIS — um por corte de legenda, na ordem:
  obra:chave[,panoramica]        a obra na tela, com deriva lateral
  detalhe:chave,zona[,aperto]    recorte (zona 0 = topo, 1 = base)
  placa:TÍTULO|DESTAQUE|RODAPÉ   placa tipográfica; 4º campo é a cor
                                 (ciano, apagado, verde, violeta)
  ilustra:arquivo.png            ilustração quadrada
  floresta                       forest plot (só se houver \`grafico:\`)
  grades, divisao, etiquetas, fecho
Qualquer um aceita #inicio-fim, que mapeia o avanço do plano dentro da
animação: floresta#0.25-0.60 continua de onde floresta#0-0.25 parou.
Um corte escrito \`-\` é plano sem legenda e ganha 1,8s fixos.
`.trim();

async function exemplo(): Promise<string> {
  // O exemplo é a pauta REAL do episódio 2, lida do disco a cada chamada.
  // Fixar uma cópia aqui faria o prompt envelhecer sem ninguém perceber: o
  // formato muda no arquivo e o modelo continua aprendendo o formato antigo.
  return readFile(path.join(PASTA_PAUTAS, "02-pilares-cientificos.yml"), "utf8");
}

export async function promptDeRascunho(entrada: {
  titulo: string;
  tema: string;
  fontes: string;
  segundos: number;
}): Promise<string> {
  return [
    "Você escreve a pauta de um episódio curto (YouTube Shorts, 9:16) do canal",
    "do NeuroArt DApp: arte de artistas neurodivergentes tokenizada na Base,",
    "fracionada, com parte de cada transação indo para um fundo de pesquisa em",
    "neurociência. O tom é seco e verificável, sem linguagem de marketing.",
    "",
    REGRAS,
    "",
    "EXEMPLO REAL — um episódio publicado, no formato exato que você deve seguir:",
    "```yaml",
    await exemplo(),
    "```",
    "",
    "AGORA ESCREVA UMA PAUTA NOVA.",
    `Título: ${entrada.titulo}`,
    `Duração alvo: ${entrada.segundos} segundos de fala (cerca de ` +
      `${Math.round((entrada.segundos * 5.4) / 6)} palavras).`,
    "",
    "Tema e ângulo pretendido:",
    entrada.tema,
    "",
    "Material e fontes disponíveis (use SÓ o que está aqui; não invente número,",
    "estudo, autor nem link):",
    entrada.fontes || "(nenhum material fornecido — então não afirme números)",
    "",
    "Responda APENAS com o YAML da pauta, sem cercas de markdown e sem",
    "comentário fora dele. Se o material não sustentar algum número, escreva a",
    "fala sem número em vez de inventar.",
  ].join("\n");
}

export function promptDeCorrecao(yaml: string, achados: string[]): string {
  return [
    "Você corrige a pauta de um episódio curto. Abaixo, as regras, a pauta",
    "atual e exatamente o que o linter apontou.",
    "",
    REGRAS,
    "",
    "PAUTA ATUAL:",
    "```yaml",
    yaml,
    "```",
    "",
    "O LINTER APONTOU:",
    ...achados.map((a) => `- ${a}`),
    "",
    "Corrija SÓ o que foi apontado. Não reescreva o que já está bom, não mude",
    "o sentido do episódio, não invente número nem fonte que não esteja na",
    "pauta. Responda APENAS com o YAML corrigido, sem cercas de markdown.",
  ].join("\n");
}

let clienteCache: Anthropic | null = null;

/** Chama o modelo e devolve o texto mais o uso REAL, para a conta na tela. */
export async function gerar(prompt: string, maxTokens = 6000): Promise<{
  texto: string;
  uso: Uso;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new IAIndisponivelError();
  clienteCache ??= new Anthropic({ apiKey, maxRetries: 2 });

  const r = await clienteCache.messages.create({
    model: modelo(),
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

  const texto = r.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    // O modelo às vezes devolve dentro de cerca, apesar do pedido.
    .replace(/^```(?:ya?ml)?\s*/i, "")
    .replace(/\s*```$/, "");

  return {
    texto,
    uso: {
      entrada: r.usage.input_tokens,
      saida: r.usage.output_tokens,
      modelo: modelo(),
      usd: emDolar(r.usage.input_tokens, r.usage.output_tokens),
    },
  };
}
