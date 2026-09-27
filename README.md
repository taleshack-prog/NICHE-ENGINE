# Niche Engine

Dashboard single-tenant para operar páginas de nicho *faceless* no Instagram.
Cobre o ciclo completo: **pesquisa de nicho → engenharia reversa de viral → produção (roteiro + mídia IA) → fila de publicação → métricas → iteração**.

Posts vencedores (top 10% por score de salvamentos/compartilhamentos) voltam ao swipe file como novos templates — o loop de melhoria contínua.

---

## Stack

| Camada | Escolha |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 |
| Linguagem | TypeScript estrito (`strict`, `noUncheckedIndexedAccess`, zero `any`) |
| Estilo | Tailwind CSS 4 + design system próprio (tema dark) |
| Dados | Prisma 6 · SQLite em dev · PostgreSQL em prod |
| Mutações | Server Actions com validação Zod |
| Auth | Single-user: cookie httpOnly assinado (JWT HS256 via `jose`) |
| IA | `@anthropic-ai/sdk` — roteiro, copy, decomposição viral, relatório |
| Mídia | fal.ai — FLUX (imagem) e Kling (image-to-video) |
| Publicação | Meta Graph API (Instagram Content Publishing) |
| Automação | n8n self-hosted (4 workflows em `n8n/`) |

---

## Setup em 4 comandos

```bash
npm install
cp .env.example .env          # edite: AUTH_SECRET é o único obrigatório fora do dev
npm run setup                 # prisma migrate dev --name init && seed de exemplo
npm run dev                   # http://localhost:3000
```

O `.env.example` já vem com `AUTH_DISABLED="true"`, que **ignora o login em dev**.
Para exigir login, coloque `AUTH_DISABLED="false"` e preencha:

```bash
AUTH_SECRET="$(openssl rand -base64 32)"
AUTH_USERNAME="admin"
AUTH_PASSWORD="uma-senha-longa"
```

Nenhuma chave de integração é obrigatória para rodar: **cada integração ausente
degrada com aviso na própria tela** (o botão aparece desabilitado com o motivo),
nunca quebra a aplicação.

### Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | `prisma generate` + build de produção |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `eslint .` (flat config — `next lint` foi removido no Next 16) |
| `npm run db:migrate` | cria/aplica migração |
| `npm run db:seed` | popula dados de exemplo (idempotente) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | zera o banco e re-semeia |

---

## Telas

| Rota | Conteúdo |
| --- | --- |
| `/` | KPIs da semana, gráfico de crescimento, fila de hoje, status das integrações |
| `/nichos` | Candidatos com score calculado, prompt de análise IA, transição candidato → ativo → descartado |
| `/swipe` | Grid de templates virais (gancho, padrão, performance), filtros, "decompor viral" |
| `/producao` | Kanban de 5 colunas com drag-and-drop + editor lateral (roteiro, copy, mídia, agendamento) |
| `/calendario` | Visão semanal/mensal dos agendamentos com drag-and-drop |
| `/analytics` | Métricas por post, ranking top 10%, "promover a template", relatório semanal IA |
| `/login` | Autenticação single-user (ignorada quando `AUTH_DISABLED=true`) |

---

## Modelo de dados

Sete modelos em `prisma/schema.prisma`: `Nicho`, `TemplateViral`, `Post`, `Metrica`,
`Gancho`, `Topico`, `Config`.

Três decisões que divergem da spec original **de propósito** (comentadas no schema):

1. **`@@map`/`@map` em snake_case.** Os workflows n8n escrevem SQL cru contra
   `posts`, `midia_paths`, `nicho_id`. Sem os mapeamentos, todo SQL do n8n
   falharia com *relation does not exist*. O TypeScript continua em camelCase.
2. **`estrutura`, `midiaPaths` e `hashtags` são `String` com JSON serializado, não `Json`.**
   Em PostgreSQL o tipo `Json` do Prisma vira `jsonb` e o driver devolve objeto já
   desserializado — o `JSON.parse(post.midia_paths)` do Workflow B estouraria.
   Como TEXT, o comportamento é idêntico em SQLite e PostgreSQL. Use os helpers de
   `src/lib/json-fields.ts`.
3. **`Metrica` tem `dataRef` (YYYY-MM-DD) com unique `[postId, dataRef]`.**
   O Workflow C roda diariamente; sem isso, duas execuções no mesmo dia duplicariam
   a linha e inflariam qualquer soma de alcance.

`Topico` e `Config` foram trazidos para dentro do Prisma (a spec os deixava como SQL
manual) para que `prisma migrate` seja a única fonte de verdade do banco. O SQL
equivalente, com os índices parciais que só o PostgreSQL aceita, está em `sql/`.

### Produção (PostgreSQL)

```prisma
datasource db {
  provider = "postgresql"   // era "sqlite"
  url      = env("DATABASE_URL")
}
```

```bash
DATABASE_URL="postgresql://user:pass@host:5432/niche" npx prisma migrate deploy
psql "$DATABASE_URL" -f sql/001_config_seed.sql   # índices parciais + semeadura do token
```

---

## Integrações — ordem de ativação

A ordem importa: custo e burocracia crescem da esquerda para a direita.

1. **`ANTHROPIC_API_KEY`** — desbloqueia decomposição viral, roteiro, copy e relatório.
   Modelo por tarefa é configurável (`ANTHROPIC_MODEL_*`): Haiku serve para decomposição,
   Sonnet para roteiro e relatório.
2. **`FAL_KEY`** — uma única credencial cobre FLUX (imagem) **e** Kling (vídeo), porque o
   Kling roda dentro do fal.ai (`fal-ai/kling-video`). Comece por carrossel: é o
   formato mais barato por post.
3. **Meta Graph API** — por último. Exige conta Instagram *Business* vinculada a uma
   página do Facebook e app com `instagram_content_publish` aprovado. Até o review sair,
   agende manualmente pelo Meta Business Suite.

> **O token do Meta vive na tabela `config`, não no `.env`.**
> Ele expira em ~60 dias e é rotacionado pelo Workflow D. Se o dashboard lesse de
> `$env`, a automação morreria em silêncio na primeira rotação: o `.env` ficaria com
> o token velho e todo POST voltaria erro 190. O `.env` só semeia o valor inicial.

---

## Automação n8n (`n8n/`)

| # | Arquivo | Frequência | Função |
| --- | --- | --- | --- |
| A | `workflow-a-producao.json` | diário 06:00 | tópico → Claude (roteiro) → FLUX (imagens) → Kling (vídeo) → post na fila |
| B | `workflow-b-publicacao.json` | a cada 15 min | agendados vencidos → containers → polling → `media_publish` |
| C | `workflow-c-metricas.json` | diário 07:00 (+ relatório no domingo) | insights → `metricas` → relatório IA → realimenta `topicos` |
| D | `workflow-d-token.json` | a cada 50 dias | `fb_exchange_token` → valida → atualiza `config` |

Após importar (n8n → Workflows → ⋯ → Import from File):

- [ ] Selecionar a credencial Postgres real em cada nó marcado `REPLACE_ME`
- [ ] `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` no ambiente do n8n (ou trocar `$env` por credenciais Header Auth)
- [ ] Fuso do servidor em `America/Sao_Paulo` (a guarda de domingo do Workflow C usa `getDay()`)
- [ ] Testar cada workflow com **Execute Workflow** antes de ativar o cron
- [ ] Ativar na ordem A → B → C → D

Os workflows deste repositório já vêm com as correções que a spec original listava
como ajuste manual: token lido da tabela `config`, contador de aborto no polling,
escape de aspas simples nos `INSERT` e os prompts da seção de IA embutidos.

---

## Status por fase

| Fase | Escopo | Estado |
| --- | --- | --- |
| 1 | MVP local: schema, seed, CRUD de nichos/posts/templates, kanban, swipe manual, calendário | ✅ |
| 2 | IA no fluxo: decomposição viral, roteiro (3 variações), copy, relatório — com Zod | ✅ |
| 3 | Mídia: FLUX para carrossel, Kling image-to-video, galeria no editor | ✅ |
| 4 | Analytics: registro de métricas, ranking top 10%, promover a template, relatório semanal | ✅ |
| 5 | Automação: publicação via Graph API no dashboard + 4 workflows n8n | ✅ código · ⏳ depende do review do app no Meta |

Pendências conhecidas (não bloqueiam o uso):

- Publicação real no Instagram depende de aprovação do app no Meta for Developers.
- Testes automatizados não fazem parte do escopo das 5 fases.

---

## Arquitetura em uma tela

```
src/
├─ proxy.ts                 guarda de rotas no Edge (Next 16: proxy, não middleware)
├─ actions/                 Server Actions — toda mutação passa por acao() + Zod
│  ├─ _shared.ts            contrato ActionResult<T>, envelope de erro, sessão
│  ├─ nichos · posts · templates · midia · metricas · topicos · auth
├─ lib/
│  ├─ db.ts                 singleton do PrismaClient
│  ├─ auth.ts               sessão single-user (JWT HS256)
│  ├─ domain.ts             status, formatos, pesos de métrica, chaves de config
│  ├─ scoring.ts            score de nicho e de post, corte do top 10%
│  ├─ prompts.ts            os 4 prompts + schemas Zod de saída
│  ├─ ai.ts                 callClaudeStructured — parse tolerante, falha ruidosa
│  ├─ fal.ts                FLUX e Kling (fila assíncrona com polling)
│  ├─ meta.ts               Graph API: containers, polling, publish, insights, token
│  ├─ config-store.ts       tabela config = fonte da verdade do token
│  ├─ queries.ts            leituras das telas (KPIs, kanban, analytics)
│  └─ json-fields.ts        (de)serialização dos campos TEXT que guardam JSON
├─ components/ui/           design system: botao, card, campos, tabela, modal, selo, use-acao
├─ components/layout/       casca e navegação
└─ app/                     7 rotas (6 telas + login)
```

**Contrato das Server Actions.** Nenhuma action lança para o cliente — um `throw`
em Server Action chega no browser como *"An error occurred in the Server Components
render"* e o usuário não descobre nada. Todas devolvem
`{ ok: true, data } | { ok: false, erro, campos? }`, e o hook `useAcao`
transforma isso em loading + toast + erro por campo.
