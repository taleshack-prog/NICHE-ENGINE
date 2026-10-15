/**
 * Diagnóstico da credencial da Anthropic, do lado do servidor que de fato tem
 * a variável.
 *
 * POR QUE EXISTE: a API responde `401 invalid x-api-key` para coisas muito
 * diferentes — chave ausente, chave com quebra de linha colada junto, chave de
 * outra organização, chave revogada. A mensagem crua não distingue nenhuma
 * delas, e aí o conserto vira tentativa e erro no painel da Vercel. Foi
 * exatamente esse laço que custou uma tarde no DATABASE_URL.
 *
 * NUNCA imprime o segredo: sai o tamanho, o prefixo público (`sk-ant-api03`,
 * que é igual em todas as chaves) e os últimos 4 — o bastante para comparar
 * com o painel sem expor nada utilizável.
 */

export type DiagnosticoChave = {
  presente: boolean;
  comprimento: number;
  prefixo: string;
  ultimos4: string;
  sujeira: string | null;
  http: number | null;
  modeloConfigurado: string;
  modeloExiste: boolean | null;
  modelosDisponiveis: string[];
  veredito: string;
};

// Versão da API, não data de hoje: é a string que a Anthropic exige no
// cabeçalho e ela não muda junto com o calendário.
const VERSAO = "2023-06-01";

function higiene(bruto: string): string | null {
  const limpo = bruto.trim();
  if (limpo !== bruto) {
    return "a chave tem espaço ou quebra de linha nas pontas — colar do painel " +
      "arrasta isso com frequência, e o cabeçalho HTTP sai inválido";
  }
  if (/^["']|["']$/.test(limpo)) {
    return "a chave está entre aspas. Na Vercel o valor vai cru, sem aspas";
  }
  if (!limpo.startsWith("sk-ant-")) {
    return `a chave não começa com sk-ant- (começa com "${limpo.slice(0, 7)}") — ` +
      "não é uma chave de API da Anthropic";
  }
  return null;
}

export async function diagnosticarChave(modeloConfigurado: string): Promise<DiagnosticoChave> {
  const bruto = process.env.ANTHROPIC_API_KEY ?? "";
  const chave = bruto.trim();

  const base: DiagnosticoChave = {
    presente: bruto.length > 0,
    comprimento: chave.length,
    prefixo: chave.slice(0, 12),
    ultimos4: chave.slice(-4),
    sujeira: bruto ? higiene(bruto) : null,
    http: null,
    modeloConfigurado,
    modeloExiste: null,
    modelosDisponiveis: [],
    veredito: "",
  };

  if (!base.presente) {
    return {
      ...base,
      veredito:
        "ANTHROPIC_API_KEY não existe neste ambiente. Na Vercel: Settings → " +
        "Environment Variables, com o Environment incluindo Production — e " +
        "redeploy depois, porque a variável entra no deploy, não na hora.",
    };
  }

  // /v1/models é a chamada mais barata que a API tem: não gasta token e
  // responde a pergunta inteira — se a chave vale, e se o modelo existe.
  let resposta: Response;
  try {
    resposta = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": chave, "anthropic-version": VERSAO },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return {
      ...base,
      veredito: `não consegui falar com api.anthropic.com (${(e as Error).message}).`,
    };
  }

  const http = resposta.status;
  if (http === 401) {
    return {
      ...base,
      http,
      veredito: base.sujeira
        ? `a API recusou a chave, e tem um motivo provável: ${base.sujeira}.`
        : "a API recusou a chave, e ela tem o formato certo. Ou foi revogada, " +
          "ou pertence a outra organização, ou foi colada incompleta. Compare " +
          `o tamanho (${base.comprimento} caracteres) e o final (…${base.ultimos4}) ` +
          "com a chave no console da Anthropic.",
    };
  }
  if (!resposta.ok) {
    return { ...base, http, veredito: `a API respondeu ${http} ao listar modelos.` };
  }

  const corpo = (await resposta.json()) as { data?: { id?: string }[] };
  const modelos = (corpo.data ?? []).map((m) => String(m.id)).filter(Boolean);
  const existe = modelos.includes(modeloConfigurado);

  return {
    ...base,
    http,
    modeloExiste: existe,
    modelosDisponiveis: modelos,
    veredito: existe
      ? "a chave é válida e o modelo configurado existe. Se a chamada falhou " +
        "mesmo assim, o problema é outro — crédito da conta, ou limite de uso."
      : `a chave é válida, mas o modelo "${modeloConfigurado}" não está na ` +
        "lista desta conta. Corrija ANTHROPIC_MODEL_ROTEIRO para um dos ids " +
        "listados abaixo.",
  };
}

/** Uma linha por achado, para caber na tarja de erro do editor. */
export function emTexto(d: DiagnosticoChave): string {
  const linhas = [d.veredito];
  if (d.presente) {
    linhas.push(
      `chave: ${d.comprimento} caracteres, ${d.prefixo}…${d.ultimos4}` +
      (d.http ? ` · /v1/models respondeu ${d.http}` : ""),
    );
  }
  if (d.modeloExiste === false) {
    linhas.push(`modelos disponíveis: ${d.modelosDisponiveis.join(", ")}`);
  }
  return linhas.join("\n");
}
