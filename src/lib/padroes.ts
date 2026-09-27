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

/**
 * Bloco de padrões para injetar no prompt de decomposição.
 * Sem padrões cadastrados, diz isso explicitamente — a lista vazia faria o
 * modelo tratar o placeholder como ruído.
 */
export function listaParaPrompt(padroes: readonly string[]): string {
  if (padroes.length === 0) {
    return "(nenhum padrão catalogado ainda — este é o primeiro, então crie o rótulo)";
  }
  return padroes.map((p) => `- ${p}`).join("\n");
}
