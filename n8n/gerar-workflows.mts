/**
 * Gerador dos workflows n8n.
 *
 * POR QUE UM GERADOR E NÃO 4 JSONs ESCRITOS À MÃO:
 * os prompts de IA vivem em `src/lib/prompts.ts` — fonte da verdade única. Se
 * fossem copiados para dentro do JSON, dashboard e n8n divergiriam no primeiro
 * ajuste de prompt, e o sintoma (relatório com padrão inventado, roteiro com
 * gancho repetido) só apareceria semanas depois, sem pista da causa.
 *
 * Uso:  npx tsx n8n/gerar-workflows.mts
 * Saída: n8n/workflow-{a,b,c,d}-*.json  (commitados — o n8n importa arquivo)
 *
 * CORREÇÕES em relação ao rascunho da spec, todas propositais:
 *  1. Token do Meta lido da tabela `config`, nunca de $env — ele roda a cada
 *     ~50 dias (Workflow D) e o .env ficaria com o valor velho.
 *  2. Polling com teto via $runIndex + nó Stop and Error: vídeo preso em
 *     processamento não deixa a execução viva para sempre.
 *  3. SQL montado em nó Code com escape explícito (helper `q`), não por
 *     interpolação de template — apóstrofo em gancho quebrava o INSERT.
 *  4. `ORDER BY prioridade DESC` na fila de pauta (o rascunho pegava a de
 *     MENOR prioridade).
 *  5. INSERT de métrica com ON CONFLICT (post_id, data_ref): a coleta é
 *     diária e idempotente.
 *  6. Workflow D roda todo dia e só age quando o token passa de 45 dias —
 *     cron não expressa "a cada 50 dias" de forma confiável.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODELO_PADRAO } from "../src/lib/ai.js";
import {
  decomposeViralPrompt,
  gerarCopyPrompt,
  gerarRoteiroPrompt,
  relatorioSemanalPrompt,
} from "../src/lib/prompts.js";

const AQUI = dirname(fileURLToPath(import.meta.url));

// Silencia o "declarado e não usado": importados para garantir que o módulo de
// prompts compila e para deixar explícito quais existem.
void decomposeViralPrompt;
void gerarCopyPrompt;

const PG = { postgres: { id: "REPLACE_ME", name: "Postgres DB" } };

type No = {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: typeof PG;
  webhookId?: string;
};

function pgNo(id: string, name: string, pos: [number, number], query: string): No {
  return {
    id,
    name,
    type: "n8n-nodes-base.postgres",
    typeVersion: 2.5,
    position: pos,
    parameters: { operation: "executeQuery", query, options: {} },
    credentials: PG,
  };
}

function http(
  id: string,
  name: string,
  pos: [number, number],
  parameters: Record<string, unknown>,
): No {
  return { id, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: pos, parameters };
}

function code(id: string, name: string, pos: [number, number], jsCode: string): No {
  return { id, name, type: "n8n-nodes-base.code", typeVersion: 2, position: pos, parameters: { jsCode } };
}

function se(
  id: string,
  name: string,
  pos: [number, number],
  left: string,
  right: string | number | boolean,
  tipo: "string" | "number" | "boolean" = "string",
  operation = "equals",
): No {
  return {
    id,
    name,
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: pos,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [
          {
            id: `${id}-c1`,
            leftValue: left,
            rightValue: right,
            operator: { type: tipo, operation },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
  };
}

function espera(id: string, name: string, pos: [number, number], segundos: number): No {
  return {
    id,
    name,
    type: "n8n-nodes-base.wait",
    typeVersion: 1.1,
    position: pos,
    parameters: { amount: segundos, unit: "seconds" },
    webhookId: `${id}-hook`,
  };
}

function erro(id: string, name: string, pos: [number, number], mensagem: string): No {
  return {
    id,
    name,
    type: "n8n-nodes-base.stopAndError",
    typeVersion: 1,
    position: pos,
    parameters: { errorMessage: mensagem },
  };
}

/** Helper de escape injetado nos nós Code que montam SQL. */
const HELPER_SQL = `
// Escape de literal SQL. Apóstrofo em gancho ("Ninguém 'te' conta") quebra
// qualquer INSERT montado por interpolação — por isso todo texto passa aqui.
const q = (v) => (v === null || v === undefined || v === '' ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'");
const n = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? 'NULL' : String(Number(v)));
`.trim();

/** Uma linha por par chave/valor da tabela config — usada por B, C e D. */
const SQL_CREDENCIAIS = `SELECT
  MAX(CASE WHEN chave = 'meta_long_lived_token' THEN valor END) AS token,
  MAX(CASE WHEN chave = 'ig_user_id' THEN valor END) AS ig_user_id,
  COALESCE(MAX(CASE WHEN chave = 'meta_graph_version' THEN valor END), 'v21.0') AS versao,
  MAX(CASE WHEN chave = 'meta_long_lived_token' THEN atualizado_em END) AS token_atualizado_em
FROM config;`;

function conexoes(pares: Array<[string, string] | [string, string, number]>) {
  const out: Record<string, { main: Array<Array<{ node: string; type: "main"; index: number }>> }> = {};
  for (const [de, para, saida = 0] of pares) {
    out[de] ??= { main: [] };
    const m = out[de].main;
    while (m.length <= saida) m.push([]);
    m[saida]!.push({ node: para, type: "main", index: 0 });
  }
  return out;
}

function salvar(arquivo: string, name: string, nodes: No[], connections: unknown) {
  const wf = { name, active: false, settings: { executionOrder: "v1" }, pinData: {}, nodes, connections };
  writeFileSync(join(AQUI, arquivo), JSON.stringify(wf, null, 2) + "\n", "utf8");
  console.log(`✓ ${arquivo} (${nodes.length} nós)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW A — Pipeline de produção (diário 06:00)
// ─────────────────────────────────────────────────────────────────────────────
{
  const nodes: No[] = [
    {
      id: "a1",
      name: "Schedule 06:00",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [-820, 0],
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 6 * * *" }] } },
    },
    pgNo(
      "a2",
      "Selecionar Tópico",
      [-600, 0],
      // DESC: a fila de pauta é ordenada por prioridade MAIOR primeiro.
      `SELECT id, tema, nicho_id FROM topicos WHERE status = 'pendente' ORDER BY prioridade DESC, criado_em ASC LIMIT 1;`,
    ),
    pgNo(
      "a3",
      "Contexto do Nicho",
      [-380, 0],
      // Swipe file e gancho anterior numa consulta: o prompt de roteiro exige
      // 3 templates diferentes e proíbe repetir o gancho do post anterior.
      `SELECT
  COALESCE((
    SELECT string_agg(padrao || ' — gancho: ' || gancho, E'\\n')
    FROM (SELECT padrao, gancho FROM templates_virais
          WHERE nicho_id = '{{ $json.nicho_id }}'
          ORDER BY COALESCE(performance, 0) DESC LIMIT 6) t
  ), 'sem templates cadastrados') AS swipe_file,
  COALESCE((
    SELECT titulo FROM posts
    WHERE nicho_id = '{{ $json.nicho_id }}'
    ORDER BY criado_em DESC LIMIT 1
  ), 'nenhum') AS gancho_anterior,
  COALESCE((SELECT persona FROM nichos WHERE id = '{{ $json.nicho_id }}'), '') AS persona;`,
    ),
    code(
      "a4",
      "Montar Prompt",
      [-160, 0],
      `const topico = $('Selecionar Tópico').first().json;
const ctx = $input.first().json;

const PROMPT = ${JSON.stringify(gerarRoteiroPrompt)};

const prompt = PROMPT
  .replace('{{tema}}', topico.tema)
  .replace('{{swipeFile}}', ctx.swipe_file)
  .replace('{{ganchoAnterior}}', ctx.gancho_anterior);

return [{ json: { prompt, tema: topico.tema, nichoId: topico.nicho_id, topicoId: topico.id } }];`,
    ),
    http("a5", "Claude - Gerar Roteiro", [60, 0], {
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "x-api-key", value: "={{ $env.ANTHROPIC_API_KEY }}" },
          { name: "anthropic-version", value: "2023-06-01" },
          { name: "content-type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      // max_tokens 4096: com 2000 as 3 variações truncavam no meio do JSON.
      // Modelo vem de src/lib/ai.ts — dashboard e n8n não podem divergir aqui.
      jsonBody: `={{ JSON.stringify({ model: '${MODELO_PADRAO.roteiro}', max_tokens: 4096, messages: [{ role: 'user', content: $json.prompt }] }) }}`,
      options: { response: { response: { neverError: false } } },
    }),
    code(
      "a6",
      "Parse e Valida",
      [280, 0],
      `const raw = $input.first().json;
const blocos = (raw.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
const texto = blocos.replace(/\`\`\`(?:json)?/gi, '').trim();

let parsed;
try { parsed = JSON.parse(texto); }
catch (e) { throw new Error('Claude devolveu JSON inválido: ' + texto.slice(0, 300)); }

if (!Array.isArray(parsed.variacoes) || parsed.variacoes.length !== 3) {
  throw new Error('Esperadas 3 variações, vieram ' + (parsed.variacoes || []).length);
}

const v = parsed.variacoes[0];
const ctx = $('Montar Prompt').first().json;
const roteiro = [v.gancho, '', v.corpo, '', v.loop, '', v.cta].join('\\n');

return [{ json: {
  titulo: v.gancho.slice(0, 120),
  roteiro,
  gancho: v.gancho,
  corpo: v.corpo,
  tema: ctx.tema,
  nichoId: ctx.nichoId,
  topicoId: ctx.topicoId,
  variacoes: parsed.variacoes,
} }];`,
    ),
    http("a7", "Fal - Gerar Imagens", [500, 0], {
      method: "POST",
      url: "https://fal.run/fal-ai/flux/dev",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "Authorization", value: "=Key {{ $env.FAL_KEY }}" },
          { name: "content-type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ prompt: 'Cinematic b-roll still for a faceless social video about: ' + $json.tema + '. Visual beats: ' + String($json.corpo).slice(0, 320) + '. No text, no watermark, no faces.', image_size: 'portrait_16_9', num_images: 3 }) }}",
      options: {},
    }),
    http("a8", "Kling - Submeter Vídeo", [720, 0], {
      method: "POST",
      url: "https://queue.fal.run/fal-ai/kling-video/v1/standard/image-to-video",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "Authorization", value: "=Key {{ $env.FAL_KEY }}" },
          { name: "content-type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ image_url: $json.images[0].url, prompt: 'Slow cinematic push-in, subtle parallax, film grain', duration: '5' }) }}",
      options: {},
    }),
    espera("a9", "Wait 30s", [940, 0], 30),
    http("a10", "Poll Status Kling", [1160, 0], {
      url: "={{ $('Kling - Submeter Vídeo').first().json.status_url }}",
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "Authorization", value: "=Key {{ $env.FAL_KEY }}" }],
      },
      options: {},
    }),
    se("a11", "Concluiu?", [1380, 0], "={{ $json.status }}", "COMPLETED"),
    // Teto do polling: $runIndex conta as execuções do nó dentro do loop.
    se("a12", "Tentativas < 20?", [1380, 200], "={{ $runIndex }}", 20, "number", "lt"),
    erro(
      "a13",
      "Abortar - Vídeo Travado",
      [1600, 200],
      "Kling não finalizou em ~10 min. Verifique se a URL da imagem do Fal ainda é pública.",
    ),
    http("a14", "Buscar Vídeo", [1600, -120], {
      url: "={{ $('Kling - Submeter Vídeo').first().json.response_url }}",
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "Authorization", value: "=Key {{ $env.FAL_KEY }}" }],
      },
      options: {},
    }),
    code(
      "a15",
      "Montar INSERT",
      [1820, -120],
      `${HELPER_SQL}

const post = $('Parse e Valida').first().json;
const imgs = ($('Fal - Gerar Imagens').first().json.images || []).map(i => ({ tipo: 'imagem', url: i.url }));
const video = $input.first().json?.video?.url;

const midia = video ? [{ tipo: 'video', url: video }, ...imgs] : imgs;
if (!midia.length) throw new Error('Nenhuma mídia gerada — não faz sentido criar o post.');

// id gerado aqui porque o cuid() do Prisma é do lado da aplicação.
const sql = \`INSERT INTO posts (id, titulo, formato, roteiro, legenda, hashtags, midia_paths, status, nicho_id, criado_em, atualizado_em)
VALUES (gen_random_uuid()::text, \${q(post.titulo)}, 'reel', \${q(post.roteiro)}, NULL, NULL, \${q(JSON.stringify(midia))}, 'pronto', \${q(post.nichoId)}, NOW(), NOW())
RETURNING id;\`;

return [{ json: { sql, topicoId: post.topicoId, titulo: post.titulo } }];`,
    ),
    pgNo("a16", "Salvar Post", [2040, -120], "={{ $json.sql }}"),
    pgNo(
      "a17",
      "Marcar Tópico Produzido",
      [2260, -120],
      "=UPDATE topicos SET status = 'em_producao' WHERE id = {{ $('Montar INSERT').first().json.topicoId }};",
    ),
  ];

  salvar(
    "workflow-a-producao.json",
    "Niche Engine - A: Pipeline de Produção",
    nodes,
    conexoes([
      ["Schedule 06:00", "Selecionar Tópico"],
      ["Selecionar Tópico", "Contexto do Nicho"],
      ["Contexto do Nicho", "Montar Prompt"],
      ["Montar Prompt", "Claude - Gerar Roteiro"],
      ["Claude - Gerar Roteiro", "Parse e Valida"],
      ["Parse e Valida", "Fal - Gerar Imagens"],
      ["Fal - Gerar Imagens", "Kling - Submeter Vídeo"],
      ["Kling - Submeter Vídeo", "Wait 30s"],
      ["Wait 30s", "Poll Status Kling"],
      ["Poll Status Kling", "Concluiu?"],
      ["Concluiu?", "Buscar Vídeo", 0],
      ["Concluiu?", "Tentativas < 20?", 1],
      ["Tentativas < 20?", "Wait 30s", 0],
      ["Tentativas < 20?", "Abortar - Vídeo Travado", 1],
      ["Buscar Vídeo", "Montar INSERT"],
      ["Montar INSERT", "Salvar Post"],
      ["Salvar Post", "Marcar Tópico Produzido"],
    ]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW B — Publicação via Meta Graph API (a cada 15 min)
// ─────────────────────────────────────────────────────────────────────────────
{
  const CRED = "$('Ler Credenciais').first().json";

  const nodes: No[] = [
    {
      id: "b1",
      name: "Schedule 15min",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [-820, 0],
      parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 15 }] } },
    },
    // Token da tabela config — NUNCA de $env: o Workflow D o rotaciona.
    pgNo("b2", "Ler Credenciais", [-600, 0], SQL_CREDENCIAIS),
    se("b3", "Tem Token?", [-380, 0], "={{ $json.token }}", "", "string", "notEmpty"),
    erro(
      "b4",
      "Abortar - Sem Token",
      [-160, 200],
      "Tabela config sem meta_long_lived_token. Rode o Workflow D ou preencha a chave.",
    ),
    pgNo(
      "b5",
      "Selecionar Agendados",
      [-160, -120],
      `SELECT id, titulo, formato, legenda, hashtags, midia_paths
FROM posts
WHERE status = 'agendado' AND agendado_para <= NOW()
ORDER BY agendado_para ASC
LIMIT 10;`,
    ),
    {
      id: "b6",
      name: "Um Post Por Vez",
      type: "n8n-nodes-base.splitInBatches",
      typeVersion: 3,
      position: [60, -120],
      // batchSize 1: o Graph API limita 25 publicações/24h por conta e
      // responde 429 em rajada.
      parameters: { batchSize: 1, options: {} },
    },
    se("b7", "É Carrossel?", [280, 0], "={{ $json.formato }}", "carrossel"),
    code(
      "b8",
      "Preparar Imagens",
      [500, -160],
      `const post = $input.first().json;
// midia_paths é TEXT com JSON (ver decisão 2 do schema): parse sempre funciona,
// em SQLite e em PostgreSQL.
const midia = typeof post.midia_paths === 'string' ? JSON.parse(post.midia_paths || '[]') : (post.midia_paths || []);
const imagens = midia.filter(m => m.tipo === 'imagem');

if (imagens.length < 2) throw new Error('Carrossel exige no mínimo 2 imagens: ' + post.titulo);
if (imagens.length > 10) throw new Error('Carrossel aceita no máximo 10 imagens: ' + post.titulo);

// A capa gerada pelo dashboard mora em /midia/capas/... — caminho local. O Meta
// BAIXA o arquivo do lado dele, então precisa de endereco publico.
const BASE = ($env.APP_PUBLIC_URL || '').replace(/\\/+$/, '');
function publica(u) {
  if (/^https?:\\/\\//i.test(u)) return u;
  if (!BASE) throw new Error('Midia local (' + u + ') e APP_PUBLIC_URL vazia no n8n: o Meta nao alcanca localhost.');
  return BASE + '/' + u.replace(/^\\/+/, '');
}

return imagens.map(m => ({ json: { postId: post.id, legenda: post.legenda || '', url: publica(m.url) } }));`,
    ),
    http("b9", "Criar Container Filho", [720, -160], {
      method: "POST",
      url: `=https://graph.facebook.com/{{ ${CRED}.versao }}/{{ ${CRED}.ig_user_id }}/media`,
      sendQuery: true,
      queryParameters: { parameters: [{ name: "access_token", value: `={{ ${CRED}.token }}` }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ image_url: $json.url, is_carousel_item: true }) }}",
      options: {},
    }),
    code(
      "b10",
      "Agrupar Containers",
      [940, -160],
      `const post = $('Um Post Por Vez').first().json;
const ids = $input.all().map(i => i.json.id).filter(Boolean);
if (!ids.length) throw new Error('Nenhum container filho criado para ' + post.titulo);
return [{ json: { childrenIds: ids.join(','), legenda: post.legenda || '' } }];`,
    ),
    http("b11", "Criar Container Pai", [1160, -160], {
      method: "POST",
      url: `=https://graph.facebook.com/{{ ${CRED}.versao }}/{{ ${CRED}.ig_user_id }}/media`,
      sendQuery: true,
      queryParameters: { parameters: [{ name: "access_token", value: `={{ ${CRED}.token }}` }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ media_type: 'CAROUSEL', children: $json.childrenIds, caption: $json.legenda }) }}",
      options: {},
    }),
    code(
      "b12",
      "Preparar Reel",
      [500, 160],
      `const post = $input.first().json;
const midia = typeof post.midia_paths === 'string' ? JSON.parse(post.midia_paths || '[]') : (post.midia_paths || []);
const video = midia.find(m => m.tipo === 'video');
if (!video) throw new Error('Reel exige um item de mídia do tipo vídeo: ' + post.titulo);

// A capa gerada pelo dashboard mora em /midia/capas/... — caminho local. O Meta
// BAIXA o arquivo do lado dele, então precisa de endereco publico.
const BASE = ($env.APP_PUBLIC_URL || '').replace(/\\/+$/, '');
function publica(u) {
  if (/^https?:\\/\\//i.test(u)) return u;
  if (!BASE) throw new Error('Midia local (' + u + ') e APP_PUBLIC_URL vazia no n8n: o Meta nao alcanca localhost.');
  return BASE + '/' + u.replace(/^\\/+/, '');
}

// A capa vai como cover_url do Reel — o Instagram mostra ela antes do play.
// Usar a capa como primeiro quadro do vídeo faria o Kling deformar as letras.
const capa = midia.find(m => m.papel === 'capa');
return [{ json: { url: publica(video.url), coverUrl: capa ? publica(capa.url) : '', legenda: post.legenda || '' } }];`,
    ),
    http("b13", "Criar Container Reel", [720, 160], {
      method: "POST",
      url: `=https://graph.facebook.com/{{ ${CRED}.versao }}/{{ ${CRED}.ig_user_id }}/media`,
      sendQuery: true,
      queryParameters: { parameters: [{ name: "access_token", value: `={{ ${CRED}.token }}` }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify(Object.assign({ media_type: 'REELS', video_url: $json.url, caption: $json.legenda, share_to_feed: true }, $json.coverUrl ? { cover_url: $json.coverUrl } : {})) }}",
      options: {},
    }),
    // Ponto de junção: os dois ramos produzem {id}. Sem isto o nó de polling
    // precisaria de uma expressão com dupla referência (o bug que a spec avisa).
    {
      id: "b14",
      name: "Container Criado",
      type: "n8n-nodes-base.noOp",
      typeVersion: 1,
      position: [1380, 0],
      parameters: {},
    },
    espera("b15", "Wait 60s", [1600, 0], 60),
    http("b16", "Poll Container", [1820, 0], {
      url: `=https://graph.facebook.com/{{ ${CRED}.versao }}/{{ $('Container Criado').first().json.id }}`,
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: "fields", value: "status_code,status" },
          { name: "access_token", value: `={{ ${CRED}.token }}` },
        ],
      },
      options: {},
    }),
    se("b17", "Processou?", [2040, 0], "={{ $json.status_code }}", "FINISHED"),
    se("b18", "Tentativas < 10?", [2040, 200], "={{ $runIndex }}", 10, "number", "lt"),
    erro(
      "b19",
      "Abortar - Container Travado",
      [2260, 200],
      "Container não finalizou em ~10 min. Vídeo precisa ser vertical, com áudio, em URL pública que não expira.",
    ),
    http("b20", "Publicar", [2260, -160], {
      method: "POST",
      url: `=https://graph.facebook.com/{{ ${CRED}.versao }}/{{ ${CRED}.ig_user_id }}/media_publish`,
      sendQuery: true,
      queryParameters: { parameters: [{ name: "access_token", value: `={{ ${CRED}.token }}` }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ creation_id: $('Container Criado').first().json.id }) }}",
      options: {},
    }),
    code(
      "b21",
      "Montar UPDATE",
      [2480, -160],
      `${HELPER_SQL}

const igPostId = $input.first().json.id;
const postId = $('Um Post Por Vez').first().json.id;
if (!igPostId) throw new Error('media_publish não devolveu id');

const sql = \`UPDATE posts SET status = 'publicado', publicado_em = NOW(), atualizado_em = NOW(), erro_publicacao = NULL, ig_post_id = \${q(igPostId)} WHERE id = \${q(postId)};\`;
return [{ json: { sql } }];`,
    ),
    pgNo("b22", "Atualizar Post", [2700, -160], "={{ $json.sql }}"),
  ];

  salvar(
    "workflow-b-publicacao.json",
    "Niche Engine - B: Publicação Graph API",
    nodes,
    conexoes([
      ["Schedule 15min", "Ler Credenciais"],
      ["Ler Credenciais", "Tem Token?"],
      ["Tem Token?", "Selecionar Agendados", 0],
      ["Tem Token?", "Abortar - Sem Token", 1],
      ["Selecionar Agendados", "Um Post Por Vez"],
      // saída 0 = "done" (fila vazia, encerra); saída 1 = "loop"
      ["Um Post Por Vez", "É Carrossel?", 1],
      ["É Carrossel?", "Preparar Imagens", 0],
      ["É Carrossel?", "Preparar Reel", 1],
      ["Preparar Imagens", "Criar Container Filho"],
      ["Criar Container Filho", "Agrupar Containers"],
      ["Agrupar Containers", "Criar Container Pai"],
      ["Criar Container Pai", "Container Criado"],
      ["Preparar Reel", "Criar Container Reel"],
      ["Criar Container Reel", "Container Criado"],
      ["Container Criado", "Wait 60s"],
      ["Wait 60s", "Poll Container"],
      ["Poll Container", "Processou?"],
      ["Processou?", "Publicar", 0],
      ["Processou?", "Tentativas < 10?", 1],
      ["Tentativas < 10?", "Wait 60s", 0],
      ["Tentativas < 10?", "Abortar - Container Travado", 1],
      ["Publicar", "Montar UPDATE"],
      ["Montar UPDATE", "Atualizar Post"],
      ["Atualizar Post", "Um Post Por Vez"],
    ]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW C — Coleta de métricas + relatório semanal (diário 07:00)
// ─────────────────────────────────────────────────────────────────────────────
{
  const CRED = "$('Ler Credenciais').first().json";

  const nodes: No[] = [
    {
      id: "c1",
      name: "Schedule 07:00",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [-820, 0],
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 7 * * *" }] } },
    },
    pgNo("c2", "Ler Credenciais", [-600, 0], SQL_CREDENCIAIS),
    pgNo(
      "c3",
      "Posts da Semana",
      [-380, 0],
      `SELECT id, titulo, ig_post_id, formato
FROM posts
WHERE status = 'publicado'
  AND ig_post_id IS NOT NULL
  AND publicado_em >= NOW() - INTERVAL '7 days'
ORDER BY publicado_em ASC;`,
    ),
    {
      id: "c4",
      name: "Um Post Por Vez",
      type: "n8n-nodes-base.splitInBatches",
      typeVersion: 3,
      position: [-160, 0],
      parameters: { batchSize: 1, options: {} },
    },
    http("c5", "Graph API Insights", [60, 160], {
      url: `=https://graph.facebook.com/{{ ${CRED}.versao }}/{{ $json.ig_post_id }}/insights`,
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: "metric", value: "reach,saved,shares,comments,total_interactions" },
          { name: "access_token", value: `={{ ${CRED}.token }}` },
        ],
      },
      // continueRegularOutput: um post apagado no Instagram não deve derrubar
      // a coleta dos outros.
      onError: "continueRegularOutput",
      options: {},
    }),
    code(
      "c6",
      "Normalizar e Montar INSERT",
      [280, 160],
      `${HELPER_SQL}

const post = $('Um Post Por Vez').first().json;
const raw = $input.first().json;
const dados = raw.data || [];

// A Graph API alterna entre values[0].value e total_value.value conforme a
// métrica e a versão — aceitar os dois evita zerar silenciosamente.
const pegar = (nome) => {
  const m = dados.find(x => x.name === nome);
  const v = m?.values?.[0]?.value ?? m?.total_value?.value;
  return v === undefined || v === null ? null : Number(v);
};

const hoje = new Date().toISOString().slice(0, 10);

// ON CONFLICT (post_id, data_ref): a coleta é diária e precisa ser idempotente,
// senão duas execuções no mesmo dia inflam toda soma de alcance.
const sql = \`INSERT INTO metricas (id, post_id, data_coleta, data_ref, alcance, salvamentos, compartilhamentos, comentarios)
VALUES (gen_random_uuid()::text, \${q(post.id)}, NOW(), \${q(hoje)}, \${n(pegar('reach'))}, \${n(pegar('saved'))}, \${n(pegar('shares'))}, \${n(pegar('comments'))})
ON CONFLICT (post_id, data_ref) DO UPDATE SET
  alcance = EXCLUDED.alcance,
  salvamentos = EXCLUDED.salvamentos,
  compartilhamentos = EXCLUDED.compartilhamentos,
  comentarios = EXCLUDED.comentarios,
  data_coleta = NOW();\`;

return [{ json: { sql, postId: post.id } }];`,
    ),
    pgNo("c7", "Salvar Métrica", [500, 160], "={{ $json.sql }}"),
    // getDay() usa o fuso do servidor n8n — mantenha a VPS em America/Sao_Paulo.
    se("c8", "É Domingo?", [60, -160], "={{ new Date().getDay() }}", 0, "number"),
    pgNo(
      "c9",
      "Métricas Consolidadas",
      [280, -160],
      `SELECT p.titulo AS post, p.formato, COALESCE(t.padrao, 'sem template') AS padrao,
       m.alcance, m.salvamentos, m.compartilhamentos, m.comentarios,
       m.retention_3s AS retention3s, m.follows_ganhos AS follows
FROM metricas m
JOIN posts p ON p.id = m.post_id
LEFT JOIN templates_virais t ON t.id = p.template_id
WHERE m.data_coleta >= NOW() - INTERVAL '7 days'
ORDER BY m.alcance DESC NULLS LAST;`,
    ),
    code(
      "c10",
      "Preparar Payload",
      [500, -160],
      `const rows = $input.all().map(i => i.json);

// Menos de 3 posts: o prompt do relatório manda declarar incerteza, e com 1-2
// posts a IA inventaria padrão. Melhor não gastar a chamada.
if (rows.length < 3) {
  return [{ json: { suficiente: false, totalPosts: rows.length } }];
}

const PROMPT = ${JSON.stringify(relatorioSemanalPrompt)};
const prompt = PROMPT.replace('{{metricas}}', JSON.stringify(rows, null, 1));

return [{ json: { suficiente: true, prompt, totalPosts: rows.length } }];`,
    ),
    se("c11", "Dados Suficientes?", [720, -160], "={{ $json.suficiente }}", true, "boolean"),
    http("c12", "Claude - Relatório Semanal", [940, -160], {
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "x-api-key", value: "={{ $env.ANTHROPIC_API_KEY }}" },
          { name: "anthropic-version", value: "2023-06-01" },
          { name: "content-type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({ model: '${MODELO_PADRAO.relatorio}', max_tokens: 4096, messages: [{ role: 'user', content: $json.prompt }] }) }}`,
      options: {},
    }),
    code(
      "c13",
      "Parse e Montar INSERT",
      [1160, -160],
      `${HELPER_SQL}

const raw = $input.first().json;
const texto = (raw.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  .replace(/\`\`\`(?:json)?/gi, '').trim();

let rel;
try { rel = JSON.parse(texto); }
catch (e) { throw new Error('Relatório em JSON inválido: ' + texto.slice(0, 300)); }

if (!rel.recomendacaoProximaSemana) throw new Error('Relatório sem recomendação: ' + texto.slice(0, 300));

// A recomendação entra na fila de pauta com prioridade 10 e as hipóteses com 5:
// é isso que fecha o loop — o relatório define o que o Workflow A produz.
const pautas = [
  { tema: rel.recomendacaoProximaSemana, prioridade: 10 },
  ...(rel.hipoteses || []).slice(0, 3).map(h => ({ tema: h, prioridade: 5 })),
];

const valores = pautas
  .map(p => \`(\${q(String(p.tema).slice(0, 500))}, (SELECT id FROM nichos WHERE status = 'ativo' ORDER BY score DESC NULLS LAST LIMIT 1), 'pendente', \${p.prioridade}, NOW())\`)
  .join(',\\n');

const sql = \`INSERT INTO topicos (tema, nicho_id, status, prioridade, criado_em) VALUES \${valores} RETURNING id;\`;
return [{ json: { sql, pautas: pautas.length, relatorio: rel } }];`,
    ),
    pgNo("c14", "Realimentar Tópicos", [1380, -160], "={{ $json.sql }}"),
  ];

  salvar(
    "workflow-c-metricas.json",
    "Niche Engine - C: Métricas + Relatório Semanal",
    nodes,
    conexoes([
      ["Schedule 07:00", "Ler Credenciais"],
      ["Ler Credenciais", "Posts da Semana"],
      ["Posts da Semana", "Um Post Por Vez"],
      ["Um Post Por Vez", "É Domingo?", 0],
      ["Um Post Por Vez", "Graph API Insights", 1],
      ["Graph API Insights", "Normalizar e Montar INSERT"],
      ["Normalizar e Montar INSERT", "Salvar Métrica"],
      ["Salvar Métrica", "Um Post Por Vez"],
      ["É Domingo?", "Métricas Consolidadas", 0],
      ["Métricas Consolidadas", "Preparar Payload"],
      ["Preparar Payload", "Dados Suficientes?"],
      ["Dados Suficientes?", "Claude - Relatório Semanal", 0],
      ["Claude - Relatório Semanal", "Parse e Montar INSERT"],
      ["Parse e Montar INSERT", "Realimentar Tópicos"],
    ]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW D — Renovação do token do Meta
//
// Roda TODO DIA e só age quando o token passa de 45 dias. "A cada 50 dias" não
// se expressa em cron (o mês não tem 50 dias), e a versão com cron fixo falha
// silenciosamente na primeira vez que o n8n estiver fora do ar no dia marcado.
// ─────────────────────────────────────────────────────────────────────────────
{
  const CRED = "$('Token Vencendo?').first().json";

  const nodes: No[] = [
    {
      id: "d1",
      name: "Schedule 04:00",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [-600, 0],
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 4 * * *" }] } },
    },
    // Devolve 0 linhas quando o token ainda é novo → o workflow encerra sozinho.
    pgNo(
      "d2",
      "Token Vencendo?",
      [-380, 0],
      `SELECT valor AS token,
       COALESCE((SELECT valor FROM config WHERE chave = 'meta_graph_version'), 'v21.0') AS versao,
       atualizado_em
FROM config
WHERE chave = 'meta_long_lived_token'
  AND valor <> 'SEU_TOKEN_INICIAL_AQUI'
  AND atualizado_em < NOW() - INTERVAL '45 days';`,
    ),
    http("d3", "Trocar Token", [-160, 0], {
      url: `=https://graph.facebook.com/{{ $json.versao }}/oauth/access_token`,
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: "grant_type", value: "fb_exchange_token" },
          { name: "client_id", value: "={{ $env.META_APP_ID }}" },
          { name: "client_secret", value: "={{ $env.META_APP_SECRET }}" },
          { name: "fb_exchange_token", value: "={{ $json.token }}" },
        ],
      },
      options: {},
    }),
    se("d4", "Veio Token Novo?", [60, 0], "={{ $json.access_token }}", "", "string", "notEmpty"),
    erro(
      "d5",
      "Abortar - Renovação Falhou",
      [280, 200],
      "fb_exchange_token não devolveu access_token. Gere um token novo no Graph API Explorer e grave em config.meta_long_lived_token.",
    ),
    // Valida ANTES de gravar: gravar um token inválido derruba B e C juntos.
    http("d6", "Validar Token Novo", [280, -120], {
      url: `=https://graph.facebook.com/{{ ${CRED}.versao }}/me`,
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: "fields", value: "id" },
          { name: "access_token", value: "={{ $('Trocar Token').first().json.access_token }}" },
        ],
      },
      options: {},
    }),
    code(
      "d7",
      "Montar UPDATE",
      [500, -120],
      `${HELPER_SQL}

const validacao = $input.first().json;
if (!validacao.id) throw new Error('Token novo não valida em /me — não será gravado.');

const novo = $('Trocar Token').first().json.access_token;
const sql = \`UPDATE config SET valor = \${q(novo)}, atualizado_em = NOW() WHERE chave = 'meta_long_lived_token';\`;
return [{ json: { sql, validadoPara: validacao.id } }];`,
    ),
    pgNo("d8", "Gravar Token", [720, -120], "={{ $json.sql }}"),
  ];

  salvar(
    "workflow-d-token.json",
    "Niche Engine - D: Renovação Token Meta",
    nodes,
    conexoes([
      ["Schedule 04:00", "Token Vencendo?"],
      ["Token Vencendo?", "Trocar Token"],
      ["Trocar Token", "Veio Token Novo?"],
      ["Veio Token Novo?", "Validar Token Novo", 0],
      ["Veio Token Novo?", "Abortar - Renovação Falhou", 1],
      ["Validar Token Novo", "Montar UPDATE"],
      ["Montar UPDATE", "Gravar Token"],
    ]),
  );
}
