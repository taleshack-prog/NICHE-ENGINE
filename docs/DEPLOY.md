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

| Variável | Valor | Para quê |
| --- | --- | --- |
| `DATABASE_URL` | a do Railway | dashboard do Instagram |
| `AUTH_SECRET` | `openssl rand -base64 32` | assina o cookie de sessão |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | os seus | login |
| `NICHE_API_URL` | `https://<serviço>.up.railway.app` | liga o canal ao serviço |
| `NICHE_TOKEN` | o mesmo do serviço | autentica a chamada |
| `ANTHROPIC_API_KEY` | a sua chave | só os botões de IA |
| `ANTHROPIC_MODEL_ROTEIRO` | `claude-sonnet-5-5` | **não** copie o `claude-sonnet-4-5` do `.env` local: ele é aposentado em 30/11/2026 |
| `APP_PUBLIC_URL` | a URL da Vercel | o Meta baixa a capa dessa URL |
| `ANTHROPIC_PRECO_*_USD` | opcional | mostra o custo em dólar na tela |

> **NÃO copie `AUTH_DISABLED` do `.env` local.** Ele vale `"true"` aí, que é o
> certo para desenvolver. Em produção a variável é ignorada pelo código (ver
> `src/lib/auth.ts` e `src/proxy.ts`) justamente porque o caminho natural é
> abrir o `.env`, copiar tudo e colar — e o resultado seria o dashboard
> inteiro aberto na internet, com o botão de publicar.

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
