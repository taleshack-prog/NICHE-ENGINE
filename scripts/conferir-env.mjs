#!/usr/bin/env node
/**
 * Confere as variáveis que o BUILD precisa, antes do Prisma.
 *
 * POR QUE EXISTE: quando DATABASE_URL chega vazia ou torta, o Prisma falha com
 * "the URL must start with the protocol postgresql://" — a mesma mensagem para
 * variável ausente, variável com referência não resolvida (`${{...}}`), aspas
 * em volta, host sem o esquema, ou só o host:porta copiado do painel. Todas
 * ficam iguais no log, e aí o conserto vira tentativa e erro.
 *
 * Aqui o diagnóstico é explícito e NUNCA imprime segredo: do valor sai só o
 * esquema, o host, a porta, o nome do banco e o TAMANHO da senha.
 */

const exigidas = [
  ["DATABASE_URL", "dashboard do Instagram — lida também pelo `prisma migrate deploy`"],
];
const opcionais = [
  ["NICHE_API_URL", "serviço de render; sem ela o canal tenta rodar python local"],
  ["NICHE_TOKEN", "autentica no serviço de render"],
  ["AUTH_SECRET", "assina o cookie de sessão"],
  ["ANTHROPIC_API_KEY", "só os botões de IA"],
];

const problemas = [];

function diagnosticar(nome, bruto) {
  if (bruto === undefined) {
    return `${nome} NÃO EXISTE no ambiente do build.\n` +
      "    Na Vercel, variável marcada como Sensitive não é legível em build.\n" +
      "    Confira também o Environment: tem que incluir Production.";
  }
  if (bruto === "") return `${nome} está vazia.`;

  const valor = bruto.trim();
  if (valor !== bruto) {
    problemas.push(`${nome}: tem espaço ou quebra de linha nas pontas.`);
  }
  if (/^["']|["']$/.test(valor)) {
    return `${nome} está entre aspas. Na Vercel o valor vai cru, sem aspas.\n` +
      `    Começa com: ${valor.slice(0, 3)}…`;
  }
  if (valor.includes("${{")) {
    return `${nome} contém uma REFERÊNCIA do Railway (\${{...}}), não o valor.\n` +
      "    Referência só é resolvida dentro do Railway. Revele o valor lá\n" +
      "    (ícone de olho) e cole a string resolvida aqui.";
  }
  if (!/^postgres(ql)?:\/\//.test(valor)) {
    return `${nome} não começa com postgresql://\n` +
      `    Tem ${valor.length} caracteres e começa com: ${valor.slice(0, 12)}…\n` +
      "    Se isso parece um host:porta, faltou a string inteira:\n" +
      "    postgresql://USUARIO:SENHA@HOST:PORTA/BANCO";
  }

  try {
    const u = new URL(valor);
    if (!u.hostname) return `${nome}: sem host.`;
    if (u.hostname.endsWith(".railway.internal")) {
      return `${nome} aponta para ${u.hostname}, que só resolve DENTRO do Railway.\n` +
        "    A Vercel está fora. Use a DATABASE_PUBLIC_URL (proxy.rlwy.net).";
    }
    if (!u.password) {
      problemas.push(`${nome}: sem senha na string — confira se copiou inteira.`);
    }
    // O resumo só sai DEPOIS das checagens: imprimir "ok" e reprovar em
    // seguida é o tipo de log que faz procurar erro no lugar errado.
    console.log(
      `  ok  ${nome}: ${u.protocol}//${u.username}:<senha de ${u.password.length} caracteres>` +
      `@${u.hostname}:${u.port || "(sem porta)"}${u.pathname}`,
    );
  } catch (e) {
    return `${nome} não é uma URL válida (${e.message}).\n` +
      "    Caractere especial na senha precisa ser codificado: @ vira %40.";
  }
  return null;
}

console.log("conferindo o ambiente do build…");

for (const [nome, paraque] of exigidas) {
  const erro = diagnosticar(nome, process.env[nome]);
  if (erro) problemas.push(`${erro}\n    (${paraque})`);
}

for (const [nome, paraque] of opcionais) {
  if (!process.env[nome]) console.log(`  --  ${nome} ausente — ${paraque}`);
}

if (process.env.AUTH_DISABLED === "true") {
  console.log("  !!  AUTH_DISABLED=true está definida. Em produção o código a " +
    "ignora, mas ela não deveria estar aqui.");
}

if (problemas.length) {
  console.error("\nO build vai falhar por causa disto:\n");
  for (const p of problemas) console.error(`  ERRO ${p}\n`);
  process.exit(1);
}

console.log("ambiente ok\n");
