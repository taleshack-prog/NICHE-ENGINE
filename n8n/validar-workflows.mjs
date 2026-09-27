/**
 * Validação estática dos workflows n8n.
 *
 * Erro de importação no n8n é opaco ("Could not find property option") e só
 * aparece depois de clicar em Import. Estes quatro checks pegam antes:
 *   1. nomes e ids de nó duplicados (o n8n renomeia silenciosamente);
 *   2. conexão apontando para nó inexistente (ramo morto);
 *   3. nó órfão, sem entrada (nunca executa — o bug mais difícil de ver na tela);
 *   4. JS dos nós Code que não compila.
 *
 * Uso: node n8n/validar-workflows.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
let falhas = 0;

for (const arquivo of readdirSync(AQUI).filter((f) => f.endsWith(".json")).sort()) {
  const wf = JSON.parse(readFileSync(join(AQUI, arquivo), "utf8"));
  const nomes = wf.nodes.map((n) => n.name);

  const dupNome = nomes.filter((n, i) => nomes.indexOf(n) !== i);
  if (dupNome.length) {
    console.error(`✗ ${arquivo}: nós com nome duplicado — ${[...new Set(dupNome)].join(", ")}`);
    falhas++;
  }

  const ids = wf.nodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) {
    console.error(`✗ ${arquivo}: ids de nó duplicados`);
    falhas++;
  }

  for (const [origem, valor] of Object.entries(wf.connections)) {
    if (!nomes.includes(origem)) {
      console.error(`✗ ${arquivo}: conexão partindo de nó inexistente "${origem}"`);
      falhas++;
    }
    for (const saida of valor.main) {
      for (const c of saida) {
        if (!nomes.includes(c.node)) {
          console.error(`✗ ${arquivo}: conexão para nó inexistente "${c.node}"`);
          falhas++;
        }
      }
    }
  }

  const alvos = new Set(
    Object.values(wf.connections).flatMap((v) => v.main.flat().map((c) => c.node)),
  );
  for (const no of wf.nodes) {
    if (!no.type.includes("scheduleTrigger") && !alvos.has(no.name)) {
      console.error(`✗ ${arquivo}: nó órfão (sem entrada) — "${no.name}"`);
      falhas++;
    }
  }

  for (const no of wf.nodes.filter((n) => n.type.endsWith(".code"))) {
    try {
      new Function(no.parameters.jsCode);
    } catch (e) {
      console.error(`✗ ${arquivo} / ${no.name}: JS inválido — ${e.message}`);
      falhas++;
    }
  }

  console.log(
    `  ${arquivo.padEnd(30)} ${String(wf.nodes.length).padStart(2)} nós  ${
      falhas === 0 ? "ok" : ""
    }`,
  );
}

if (falhas) {
  console.error(`\n${falhas} problema(s) encontrado(s).`);
  process.exit(1);
}
console.log("\n✓ workflows válidos para importação no n8n");
