/**
 * Vocabulário de padrões do swipe file.
 *
 * POR QUE ISTO EXISTE: o `padrao` não é rótulo decorativo — é a CHAVE DE
 * AGRUPAMENTO do sistema. O relatório semanal compara performance por padrão e
 * a geração de roteiro exige três padrões diferentes. Se cada decomposição
 * inventar um rótulo ("revelação filosófica progressiva"), o banco vira N
 * padrões de 1 post cada: nenhum grupo ganha massa, nenhum vencedor emerge, e o
 * relatório declara incerteza para sempre — corretamente, porque os dados de
 * fato não sustentam conclusão nenhuma.
 *
 * A defesa é em duas camadas: o prompt pede reuso (com few-shot que demonstra o
 * reuso, não só a regra) e este módulo normaliza o que voltar. Prompt sozinho
 * não basta: "Contraste", "contraste " e "contrastes" passariam como três.
 */

/**
 * Balde único para template cujo mecanismo ainda não foi identificado.
 *
 * Aparece ao promover a template um post vencedor que não veio de template
 * nenhum: ali não se sabe o mecanismo, só que performou. Antes disso o código
 * gravava `vencedor: reel` / `vencedor: carrossel`, que não são mecanismos e
 * ainda multiplicavam por formato. Um balde nomeado e único é honesto e fica
 * visível no swipe file como algo a classificar depois.
 */
export const PADRAO_NAO_CLASSIFICADO = "sem padrão identificado";

/** Remove aspas e pontuação de borda — "contraste." e contraste são o mesmo rótulo. */
function semBordas(s: string): string {
  return s.replace(/^["'`\s]+|["'`.:;,\s]+$/g, "");
}

/**
 * Chave de comparação: minúsculas, sem acento, sem pontuação de borda,
 * espaços colapsados. Serve só para COMPARAR — nunca é o valor gravado.
 */
export function chavePadrao(s: string): string {
  return semBordas(
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " "),
  );
}

/** Forma de gravação de um padrão novo: minúsculas, sem pontuação de borda. */
export function limparPadrao(s: string): string {
  return semBordas(s.replace(/\s+/g, " ")).toLowerCase();
}

/**
 * Resolve o padrão devolvido pela IA contra o vocabulário existente.
 *
 * Se a chave bater com um padrão já catalogado, devolve a GRAFIA EXISTENTE —
 * assim o agrupamento do relatório continua íntegro. Caso contrário, devolve a
 * forma limpa do rótulo novo.
 *
 * Deliberadamente só casa igualdade exata após normalização. Similaridade
 * aproximada (Levenshtein e afins) fundiria "erro comum" com "erro de cálculo",
 * que são mecanismos distintos — e fusão errada é pior que rótulo duplicado,
 * porque corrompe silenciosamente a comparação de performance.
 */
export function canonizarPadrao(bruto: string, existentes: readonly string[]): string {
  const chave = chavePadrao(bruto);
  const achado = existentes.find((e) => chavePadrao(e) === chave);
  return achado ?? limparPadrao(bruto);
}

export type PadraoCatalogado = {
  padrao: string;
  /** Mecanismo de retenção do template de referência — o que o rótulo SIGNIFICA. */
  mecanismo: string | null;
  usos: number;
};

/**
 * Bloco de padrões para injetar no prompt de decomposição.
 *
 * Leva a DEFINIÇÃO de cada padrão, não só o nome. Mandar apenas os rótulos fez
 * o modelo casar por semelhança superficial: num teste real, um gancho
 * declarativo de curiosity gap ("O staking é uma forma de receber juros") e uma
 * analogia com falso dilema ("leva ao veterinário ou segue o guru?") foram os
 * dois catalogados como "contraste", levando 4 de 6 templates para o mesmo
 * rótulo. Sem saber o que "contraste" significa mecanicamente, reusar vira
 * chute — e agrupar por padrão volta a não dizer nada, agora por absorção em
 * vez de fragmentação.
 */
export function listaParaPrompt(padroes: readonly PadraoCatalogado[]): string {
  if (padroes.length === 0) {
    return "(nenhum padrão catalogado ainda — este é o primeiro, então crie o rótulo)";
  }
  return padroes
    .map((p) => {
      const def = p.mecanismo ? ` → mecanismo: ${p.mecanismo}` : "";
      return `- "${p.padrao}" (${p.usos} template(s))${def}`;
    })
    .join("\n");
}

export type TemplateParaRotacao = {
  padrao: string;
  gancho: string;
  performance: number | null;
  /** Posts já produzidos a partir DESTE template. */
  usos: number;
};

export type CandidatoPadrao = {
  padrao: string;
  /** Gancho do template de melhor performance dentro do padrão. */
  gancho: string;
  performance: number;
  /** Soma dos usos de TODOS os templates deste padrão. */
  usos: number;
};

/**
 * Agrupa templates por padrão e ordena do MENOS testado para o mais.
 *
 * POR QUE A ORDEM IMPORTA: o prompt de roteiro recebe esta lista e escolhe 3
 * padrões lendo de cima para baixo. Ordenando por performance — como era antes
 * — o modelo escolhia sempre os mesmos 3, e o padrão do fim da lista nunca ia a
 * campo. Sem ir a campo não acumula métrica; sem métrica o relatório semanal não
 * pode julgá-lo. O sistema ficava permanentemente cego para parte do próprio
 * vocabulário, e de forma silenciosa: nada falhava, o padrão só nunca aparecia.
 *
 * Empate em usos desempata por performance: entre dois padrões igualmente
 * inexplorados, comece pelo que tem melhor histórico de origem.
 */
export function ordenarPorRotacao(templates: readonly TemplateParaRotacao[]): CandidatoPadrao[] {
  const porPadrao = new Map<string, CandidatoPadrao>();

  for (const t of templates) {
    const atual = porPadrao.get(t.padrao);
    const perf = t.performance ?? 0;
    porPadrao.set(t.padrao, {
      padrao: t.padrao,
      // Representante é o de melhor performance; usos somam o padrão inteiro.
      gancho: !atual || perf > atual.performance ? t.gancho : atual.gancho,
      performance: Math.max(perf, atual?.performance ?? 0),
      usos: (atual?.usos ?? 0) + t.usos,
    });
  }

  return [...porPadrao.values()].sort(
    (a, b) => a.usos - b.usos || b.performance - a.performance,
  );
}

/** Linhas do swipe file como o prompt de roteiro espera lê-las. */
export function swipeFileParaPrompt(candidatos: readonly CandidatoPadrao[]): string {
  return candidatos
    .map(
      (t, i) =>
        `  ${i + 1}. padrao "${t.padrao}" — ${t.usos} post(s) produzido(s) — gancho exemplo: "${t.gancho}"`,
    )
    .join("\n");
}
