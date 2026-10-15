# Deploy — Vercel e Railway

Duas peças, e uma delas existe porque a outra não dá conta:

| Onde | O quê | Por quê |
| --- | --- | --- |
| **Vercel** | o dashboard (Next.js) | é a tela, e Next na Vercel é o caminho curto |
| **Railway — serviço** | o pacote `niche` como API | a Vercel não tem Python com pillow, não tem ffmpeg e tem disco somente leitura; a montagem precisa dos três |
| **Railway — Postgres** | banco do dashboard do Instagram | o único estado do lado do Instagram |

O dashboard do canal fala com o serviço quando `NICHE_API_URL` existe, e chama
`python3 -m niche` quando não existe. Na sua máquina nada muda: `npm run dev`
continua funcionando sem serviço nenhum no ar.

---

## 1. O serviço no Railway

**New Project → Deploy from GitHub repo → NICHE-ENGINE.**

O `railway.json` da raiz já aponta para `servico/Dockerfile`, então não há o
que configurar no build.

**Variáveis:**

```
NICHE_TOKEN=<gere com: openssl rand -base64 32>
```

É o segredo que a Vercel usa para falar com o serviço. Sem ele o serviço
recusa tudo com 401 — de propósito: ele fica aberto na internet e grava
arquivo em disco.

**`FAL_KEY`** — a mesma do `.env` local (fal.ai → Keys). É o que faz o botão
**Entregar pronto** funcionar: a narração é gerada aqui, no serviço, porque é
aqui que estão o ffmpeg e o disco. Sem ela o botão recusa antes de começar,
com essa explicação; o **Montar** continua funcionando normalmente. Confira
em `/saude`, no campo `voz`.

**Volume:** adicione um volume montado em **`/dados`**. É onde ficam pautas,
acervo e renders. Sem volume, tudo some a cada deploy — o contêiner é
descartável e o disco dele vai junto.

**Confira** abrindo `https://<seu-serviço>.up.railway.app/saude`. A resposta
diz o que o contêiner tem, não só que está de pé:

```json
{"ok": true, "ffmpeg": "ffmpeg version 6...", "matplotlib": true,
 "fonte": "/app/assets/fontes/Poppins-Bold.ttf", "pautas": 0, "obras": 0}
```

Se `ffmpeg` vier `null`, a imagem subiu errada e a primeira montagem falharia
três minutos depois, com erro de subprocesso.

## 2. O Postgres no Railway

**New → Database → PostgreSQL**, no mesmo projeto. Copie a
`DATABASE_URL` que ele gera (a pública, se a Vercel for acessar de fora).

## 3. O dashboard na Vercel

**Add New → Project → NICHE-ENGINE.**

- **Build Command:** `npm run build:vercel` — é o que aplica as migrações
  antes de compilar. O `npm run build` normal não aplica, de propósito: exigir
  banco para compilar na própria máquina seria um estorvo diário.
- **Install Command:** padrão.

**Variáveis de ambiente:**

> **A coluna do meio diz ONDE BUSCAR o valor — ela não é o valor.** Esta
> tabela já custou dois deploys quebrados: `DATABASE_URL` e
> `ANTHROPIC_API_KEY` foram ambas preenchidas na Vercel com a prosa que
> estava aqui ("a do Railway", "a sua chave"), porque num painel de copiar e
> colar tudo o que está numa coluna chamada "Valor" parece ser o valor. Nada
> aqui é colável; o que é colável aparece sozinho, num bloco de código.

| Variável | Onde buscar | Para quê |
| --- | --- | --- |
| `DATABASE_URL` | Railway → Postgres → Variables → `DATABASE_PUBLIC_URL` (a interna não resolve de fora) | dashboard do Instagram |
| `AUTH_SECRET` | gere: `openssl rand -base64 32` | assina o cookie de sessão |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | você escolhe, na hora | login |
| `NICHE_API_URL` | Railway → serviço → Settings → Domains (começa com `https://`) | liga o canal ao serviço |
| `NICHE_TOKEN` | o mesmo texto que está no Railway → serviço → Variables | autentica a chamada |
| `ANTHROPIC_API_KEY` | platform.claude.com → API keys (começa com `sk-ant-`) | só os botões de IA |
| `ANTHROPIC_MODEL_ROTEIRO` | não crie | o padrão do código é `claude-sonnet-5`, ativo. Só defina para trocar de modelo — e confira o id em `/api/youtube/diagnostico`, que lista os modelos da sua conta. **Não** copie o `claude-sonnet-4-5` do `.env` local: ele é aposentado em 30/11/2026 |
| `APP_PUBLIC_URL` | Vercel → Project → Domains | o Meta baixa a capa dessa URL |
| `ANTHROPIC_PRECO_*_USD` | não crie, a menos que queira o custo em dólar na tela | preço por milhão de tokens |

**Conferência:** nenhum desses valores tem espaço no meio, e só três começam
com texto previsível — `postgresql://`, `https://` e `sk-ant-`. Se o que você
colou não bate com isso, não é o valor.

> **NÃO copie `AUTH_DISABLED` do `.env` local.** Ele vale `"true"` aí, que é o
> certo para desenvolver. Em produção a variável é ignorada pelo código (ver
> `src/lib/auth.ts` e `src/proxy.ts`) justamente porque o caminho natural é
> abrir o `.env`, copiar tudo e colar — e o resultado seria o dashboard
> inteiro aberto na internet, com o botão de publicar.

### Quando a IA responder 401

`invalid x-api-key` é a mesma mensagem para chave ausente, chave com quebra de
linha colada junto, chave de outra organização e chave revogada. Abra
**`/api/youtube/diagnostico`** logado: ele chama `/v1/models` (não gasta token),
diz qual dos quatro casos é, e lista os modelos que a conta enxerga. Ele nunca
imprime a chave — só o tamanho, o prefixo `sk-ant-api03` e os últimos 4.

Lembre que **variável nova na Vercel só vale no próximo deploy**. Editar e não
redeployar deixa a função rodando com o valor antigo.

## 4. Primeira carga

1. Abra `/youtube/acervo` e **suba as obras, as ilustrações e as trilhas**.
   Elas não vão no git: 22 MB de arte em histórico de repositório é dívida
   permanente, e cada episódio novo traz arte nova.
2. As pautas que estão em `pautas/` no repositório **não** aparecem sozinhas no
   serviço — lá o volume começa vazio. Copie o conteúdo de cada uma pelo editor,
   ou suba por linha de comando:

```bash
for f in pautas/*.yml; do
  slug=$(basename "$f" .yml)
  curl -X PUT "$NICHE_API_URL/pautas/$slug" \
    -H "Authorization: Bearer $NICHE_TOKEN" \
    -H 'Content-Type: application/json' \
    --data-binary @<(python3 -c "import json,sys;print(json.dumps({'yaml':open('$f').read()}))")
done
```

## O que vigiar

- **Volume cheio.** Cada episódio montado ocupa ~11 MB. `/saude` diz quantos
  renders existem.
- **O serviço dorme?** Confira o plano do Railway. Se ele suspender por
  inatividade, a primeira chamada do dia demora — e o dashboard vai parecer
  travado enquanto o contêiner sobe.
- **Custo do Postgres.** O Railway cobra por uso; para um usuário só o volume
  é irrisório, mas não é gratuito como o plano do Neon.
