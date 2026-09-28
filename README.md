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
| Dados | Prisma 6 · PostgreSQL 16 (dev e prod) |
| Mutações | Server Actions com validação Zod |
| Auth | Single-user: cookie httpOnly assinado (JWT HS256 via `jose`) |
| IA | `@anthropic-ai/sdk` — roteiro, copy, decomposição viral, relatório |
| Mídia | fal.ai — FLUX (imagem) e Kling (image-to-video) |
| Publicação | Meta Graph API (Instagram Content Publishing) |
| Automação | n8n self-hosted (4 workflows em `n8n/`) |

---

## Setup

Requisitos: Node ≥ 20.12 e Docker (só para o PostgreSQL local).

```bash
npm install
cp .env.example .env          # AUTH_SECRET é o único obrigatório fora do dev
npm run setup                 # sobe o Postgres, cria a migração inicial e semeia
npm run dev                   # http://localhost:3000
```

O `npm run setup` encadeia três coisas: `docker compose up -d --wait db` (o
`--wait` importa — `up -d` volta antes do Postgres aceitar conexão e o
`migrate dev` falharia com ECONNREFUSED), depois `prisma migrate dev --name init`
e o seed.

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
| `npm run db:up` / `db:down` | sobe / derruba o PostgreSQL local |
| `npm run db:psql` | abre o psql no banco da aplicação |
| `npm run db:migrate` | cria/aplica migração |
| `npm run db:seed` | popula dados de exemplo (idempotente) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | zera o banco e re-semeia |
| `npm run n8n:gerar` | regera os workflows a partir de `src/lib/prompts.ts` |
| `npm run n8n:validar` | valida os JSONs antes de importar no n8n |

### Problemas comuns

**`failed to bind host port 0.0.0.0:5433: address already in use`**
Outra coisa já ocupa a porta. Descubra o quê e escolha uma livre:

```bash
ss -ltnp | grep 543        # o que está escutando
```

Troque `DB_PORT` **e** a porta da `DATABASE_URL` no `.env` para a mesma porta livre
e rode `npm run db:up` de novo. Dentro da rede do compose o Postgres continua na
5432, então a credencial do n8n (host `db`, porta `5432`) não muda.

**`npm warn allow-scripts ... not yet covered by allowScripts`**
Seu npm está bloqueando scripts de instalação, e um deles é o `postinstall` do
`@prisma/client`, que roda o `prisma generate`. Funciona por acidente — o
`prisma migrate` também gera o client — mas depois de um `npm install` puro o
client pode ficar velho. Autorize de uma vez:

```bash
npm approve-scripts @prisma/client @prisma/engines prisma esbuild
```

Ou rode `npm run db:generate` manualmente depois de cada `npm install`.

**Páginas carregam mas com dados que não deviam existir**
Client Prisma velho apontando para o banco antigo. `npm run db:generate` e
reinicie o `npm run dev`.

**`P3019: the datasource provider postgresql ... does not match ... migration_lock.toml, sqlite`**
Sobrou uma pasta `prisma/migrations/` de antes da migração para PostgreSQL. Ela
nunca foi versionada, então `git pull` não a remove. Confirme antes de apagar:

```bash
cat prisma/migrations/migration_lock.toml   # só siga se disser provider = "sqlite"
rm -rf prisma/migrations
npm run setup
```

⚠️ Esse `rm -rf` serve **uma vez só**, para a pasta legada de SQLite. Repetir
depois apaga a migração válida e cai no caso abaixo.

**`Drift detected` / `migration(s) are applied to the database but missing from the local migrations directory`**
O banco tem as tabelas, mas o arquivo da migração que as criou não está mais em
`prisma/migrations/`. Como em dev os dados vêm todos do seed, o caminho curto é
recriar a história do zero:

```bash
npx prisma migrate reset --force --skip-seed   # derruba o schema; não roda o seed
npm run setup                                  # recria a migração e semeia
```

O `--skip-seed` importa: sem migração aplicada não existem tabelas, e o seed
falharia no meio.

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
   O tipo `Json` do Prisma vira `jsonb` e o driver devolve objeto já desserializado —
   o `JSON.parse(post.midia_paths)` do Workflow B estouraria. Como TEXT, o
   dashboard e o n8n leem o campo do mesmo jeito. Use os helpers de
   `src/lib/json-fields.ts`.
3. **`Metrica` tem `dataRef` (YYYY-MM-DD) com unique `[postId, dataRef]`.**
   O Workflow C roda diariamente; sem isso, duas execuções no mesmo dia duplicariam
   a linha e inflariam qualquer soma de alcance.
4. **PostgreSQL também em dev, não SQLite.** A spec pedia SQLite em dev, mas
   `migration_lock.toml` trava o provider: uma migração criada em SQLite não se
   aplica em PostgreSQL, então `prisma migrate deploy` em produção falhava. Pior,
   todo SQL dos workflows n8n é exclusivo de PostgreSQL — contra SQLite a Fase 5
   seria intestável no ambiente onde ela é desenvolvida.

`Topico` e `Config` foram trazidos para dentro do Prisma (a spec os deixava como SQL
manual) para que `prisma migrate` seja a única fonte de verdade do banco. O SQL
com os índices parciais que o Prisma não gera está em `sql/001_config_seed.sql`.

### Produção

Mesmo provider, então só a URL muda:

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
4. **`APP_PUBLIC_URL`** — só para publicar pela API. O Meta **baixa** a mídia do lado
   dele: as imagens do fal já são públicas, mas a **capa** é composta aqui e servida
   em `/midia/capas/...`, endereço que só existe nesta máquina. Sem esta variável,
   "Publicar agora" recusa com a mensagem explicando; a capa continua sendo gerada e
   pode ser baixada pelo editor para postagem manual.

### Carrossel — texto em todos os slides

`gerarCarrossel` (botão **Carrossel** no editor) quebra o roteiro em 5 a 8 slides
e devolve o post inteiro pronto: um clique, nenhuma etapa em editor externo.

O roteiro nasce para narração — texto corrido. Num carrossel não há narração: o
texto na tela **é** o conteúdo. Sem essa quebra o post saía com a capa escrita e
o resto decorativo, que é uma capa com anexos.

- **`direcaoVisual`**: a IA devolve uma frase de estilo aplicada a *todos* os
  prompts de imagem. Sem ela cada slide saía de um banco de imagens diferente —
  o defeito mais visível do primeiro carrossel real que o sistema produziu.
- **Layout por papel:** capa (texto grande, caixa alta, barra de acento), conteúdo
  (filete vertical, contador `n/N` no canto) e CTA (imagem escurecida, texto
  centralizado — um pedido não pode parecer mais uma informação).
- **Ordem** vai gravada em cada item e a publicação ordena por ela, no dashboard e
  no Workflow B. Carrossel fora de ordem conta a história ao contrário.
- **Custo:** uma imagem paga por slide. O botão avisa antes.

### Reel — um clique, vídeo narrado e legendado

`Reel` no editor encadeia, tudo dentro do fal.ai com a mesma `FAL_KEY`:

1. **Narração** pt-BR (`fal-ai/kokoro/brazilian-portuguese`) a partir do roteiro.
2. **Tempos** (`fal-ai/whisper`) — a transcrição diz quanto tempo a voz levou em
   cada trecho. Estimar por contagem de palavras dessincroniza em segundos e o
   corte passa a cair no meio da frase.
3. **Cenas** — a IA quebra o roteiro em uma cena de b-roll por bloco de fala,
   com direção visual comum. Um plano único de 40 s é o que o espectador
   abandona aos cinco segundos; corte é o que sustenta retenção sem rosto.
4. **Clipes** (`FAL_MODEL_VIDEO`, Kling) — um por cena, a partir da imagem dela.
5. **Montagem** (`fal-ai/ffmpeg-api/compose`) — clipes na linha do tempo + voz.
6. **Legenda queimada** (`fal-ai/auto-caption`) — a maioria assiste sem som.
7. **Capa** sobre a primeira cena, publicada como `cover_url` do Reel.

**É retomável.** Cada etapa grava o que produziu em `midia_paths` com um
`papel` (`narracao`, `cena`, `clipe`, `final`) e a execução seguinte pula o que
já existe. Um Reel leva minutos e dezenas de chamadas pagas: sem isso, uma
falha no último passo mandaria pagar tudo de novo — e a narração nova teria
tempos diferentes, invalidando todos os clipes prontos. Para refazer do zero,
use **Refazer**; a retomada é cega e reaproveitaria os clipes antigos.

**Custo.** A estimativa aparece antes de gerar. Referência de 28/09/2026 no
v2.5-turbo/pro: US$ 0,35 por clipe de 5 s — um Reel de 40 s ≈ 8 clipes ≈
US$ 2,80. `REEL_MAX_CLIPES` recusa roteiros longos demais; `FAL_MODEL_VIDEO`
aponta para um tier mais barato quando o volume subir.

### Capa — o texto vai queimado na imagem

O `coverText` que a IA gera **não é só um campo**: `src/lib/capa.ts` compõe a frase
sobre a imagem, no tamanho canônico do Instagram (1080×1350 para feed, 1080×1920
para Reel), e o arquivo sai pronto para publicar.

- **Carrossel / imagem única:** a capa vira o primeiro slide e substitui a imagem
  limpa que a originou — publicar as duas mostraria o mesmo visual repetido.
- **Reel:** a capa **não** é o primeiro quadro do vídeo (o Kling deformaria as
  letras). Vai como `cover_url` do container — é o que o feed mostra antes do play.
- Trocar a imagem de fundo ou reescrever o texto **não** gasta geração nova: a
  imagem original fica registrada em `origemUrl` e a composição é refeita local.
- A fonte é `assets/fontes/Poppins-Bold.ttf`, versionada no repositório para a capa
  sair idêntica em qualquer máquina. Troque por `CAPA_FONTE` no `.env`.

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
- [ ] Testar cada workflow com **Execute Workflow** antes de ativar o cron
- [ ] Ativar na ordem A → B → C → D

Para testar localmente, o `docker-compose.yml` já traz um n8n configurado
(`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` e fuso `America/Sao_Paulo`, os dois ajustes
que a spec listava como manuais), atrás de um profile para não consumir RAM antes
da Fase 5:

```bash
docker compose --profile n8n up -d     # n8n em http://localhost:5678
```

Os workflows ficam montados em `/workflows` dentro do container, e a credencial
Postgres a criar aponta para host `db`, banco `niche`, usuário/senha `niche`.
O estado do n8n mora em um banco separado (`n8n`) na mesma instância — se
compartilhasse o banco da aplicação, `npm run db:reset` apagaria os workflows.

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
