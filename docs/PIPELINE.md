# Pipeline e cronologia — do estado atual à operação automática

Documento de execução. Escrito em 28/09/2026, depois de auditar o código e
verificar os requisitos atuais da Meta.

---

## O achado principal

**Não falta código.** `gerarMidia` (Fal + Kling), `agendarPost`, `publicarPost`
(Graph API completa, com polling de container e tratamento de erro 190) e os 4
workflows n8n estão implementados e verificados. Cada um está travado por uma
**credencial ausente**, não por funcionalidade faltante.

A leitura de que "falta criação por IA, agendamento e publicação" descreve o que
você vê na tela — e o que você vê na tela é o aviso amigável que cada integração
emite quando a chave não existe. É o comportamento projetado, não uma pendência.

## O segundo achado: o App Review não está no caminho crítico

A spec dizia *"Meta Graph API por último, pois exige review do app"*. Para o seu
caso, **não exige**.

App Review e verificação de negócio são necessários quando o app publica em
contas de **terceiros**. Para publicar na **sua própria** conta, basta adicionar
seu Instagram como *Instagram Tester* no app e operar em **Development mode**.

Isso importa porque o App Review da Meta passou a levar **até 20 dias** em 2026,
com rejeição automática de submissões incompletas. Era o item que empurraria a
operação para outubro. Sai do caminho.

> Confira no momento do setup: a Meta muda requisitos sem aviso. O que está aqui
> valia em 28/09/2026.

## A terceira coisa: agendamento não tem executor no dashboard

`agendarPost` marca o post com data e status `agendado`. **Nada no dashboard
publica quando a hora chega** — não existe rota de API nem cron no Next.

Quem executa é o **Workflow B do n8n**, que roda a cada 15 minutos, busca
agendados vencidos e publica. Sem o n8n no ar, o calendário é um marcador visual
e nada sai sozinho.

Não é defeito: é a arquitetura da spec, que colocou a automação no n8n. Mas
significa que **subir o n8n não é opcional** se você quer publicação automática.

---

## O que falta, de fato

| # | Item | Natureza | Tempo | Bloqueia |
| --- | --- | --- | --- | --- |
| 1 | `FAL_KEY` | credencial + créditos | 15 min | geração de imagem e vídeo |
| 2 | Conta Instagram **Business** vinculada a uma Página do Facebook | configuração de conta | 30 min | tudo do Meta |
| 3 | App Meta em Development mode + seu IG como *Instagram Tester* + token de longa duração na tabela `config` | configuração de app | 1-2 h | publicação e métricas |
| 4 | n8n no ar com os 4 workflows importados | infra (já no docker-compose) | 1 h | execução do agendamento |

Nada acima é desenvolvimento. São quatro configurações.

---

## Cronologia

### Dia 1 — Mídia (Fase 3)

1. Criar chave em fal.ai, colocar créditos, gravar em `FAL_KEY` no `.env`.
2. Reiniciar o dev server (o Next lê o `.env` só na inicialização).
3. No editor de um post web3: **gerar imagem** → conferir → **gerar vídeo**.

O Kling é image-to-video: precisa de pelo menos uma imagem antes. O editor já
recusa a ordem errada com a mensagem explicando.

**Resultado:** os 3 primeiros posts web3 com mídia real, prontos para publicar.

### Dia 1-2 — Meta (Fase 5, parte 1)

1. Converter a conta Instagram para **Business** (não Creator: Creator não
   publica por API).
2. Vincular a uma Página do Facebook.
3. Criar app em developers.facebook.com, produto **Instagram**.
4. Adicionar sua conta Instagram como **Instagram Tester** e aceitar o convite
   pelo app do Instagram (Configurações → Apps e sites → Convites de tester).
5. Gerar token de longa duração e gravar na tabela `config`:

```bash
npm run db:psql -- -c "UPDATE config SET valor = 'SEU_TOKEN', atualizado_em = NOW() WHERE chave = 'meta_long_lived_token';"
npm run db:psql -- -c "UPDATE config SET valor = 'SEU_IG_USER_ID', atualizado_em = NOW() WHERE chave = 'ig_user_id';"
```

> O token vive na tabela `config`, não no `.env`. Ele é rotacionado a cada ~50
> dias pelo Workflow D — se o dashboard lesse do `.env`, a automação morreria
> silenciosamente na primeira rotação.

6. **Publicar 1 post de teste pelo dashboard** (botão "Publicar agora"). É o
   teste de fumaça de toda a cadeia: token, container, polling, `media_publish`.

**Ponto de atenção conhecido:** a URL da mídia precisa ser pública e estável —
o Meta baixa o arquivo do lado dele. URLs assinadas que expiram rápido são a
causa nº 1 de container travado em processamento.

### Dia 2 — n8n (Fase 5, parte 2)

```bash
docker compose --profile n8n up -d     # http://localhost:5678
```

Importar os 4 JSONs de `n8n/`. Em cada nó marcado `REPLACE_ME`, selecionar a
credencial Postgres: host `db`, porta `5432`, banco `niche`, usuário e senha
`niche`.

Testar cada workflow com **Execute Workflow** antes de ativar o cron.

### Dia 3 — Ativação, em ordem

| Ordem | Workflow | Ativar? | Porquê |
| --- | --- | --- | --- |
| 1º | **D** — renovação do token | **sim, primeiro** | 50 dias parece longe até o dia em que tudo para. Ativar por último é como não ativar. |
| 2º | **B** — publicação | sim | é o que transforma o calendário em publicação real |
| 3º | **C** — métricas + relatório | sim | alimenta o loop |
| 4º | **A** — produção automática 06h | **ainda não** | ver abaixo |

**Por que segurar o Workflow A.** Ele gera roteiro por IA às 06h e joga na fila
sem revisão humana. Com o vocabulário de padrões do web3 ainda em hipótese e zero
dado de performance, ele produziria em cima de apostas não validadas, em volume.
Ative depois do primeiro relatório semanal com massa — quando houver evidência
de qual padrão sustenta.

### Semanas 1 a 3 — Operação

Ritmo: **3 posts por semana**, um por padrão distinto.

Para o primeiro ciclo do web3, use `contraste de taxa`, `ordem invertida` e
`analogia de oficio`. Deixe `cenario hipotetico` para a semana seguinte: ele e o
`contraste de taxa` dependem da mesma alavanca (o choque com o valor da taxa), e
publicar os dois juntos confunde mecanismo com alavanca na hora de ler o
resultado.

Publique os três no mesmo horário. Horário é variável de confusão: se um post sai
às 9h e outro às 21h, a diferença de desempenho pode ser do horário e não do
padrão, e o relatório não tem como separar.

### Dia ~21 — Primeiro relatório com massa

O relatório exige 3 posts com métricas nos últimos 7 dias, **do mesmo nicho**.
Com 3 posts por semana, a terceira semana é a primeira com janela cheia e
histórico para comparar.

A partir daí o loop fecha sozinho: relatório → tópicos na fila de pauta →
produção → métricas → relatório.

---

## Dependências que só o tempo resolve

| Item | Prazo | Consequência de esquecer |
| --- | --- | --- |
| Token do Meta expira | ~60 dias | B e C param juntos, em silêncio. O Workflow D existe para isso — ative-o primeiro. |
| Primeiro relatório do web3 | ~21 dias | nenhuma: é só o tempo de acumular dado honesto |
| Hipóteses viram templates | 3-6 semanas | o swipe file continua sendo aposta em vez de evidência |

---

## O que continua fora de alcance

**Descoberta automática de virais alheios.** A busca por hashtag do Instagram
devolve `caption`, `like_count` e `comments_count` — mas **não** devolve contagem
de views, **não** devolve transcrição, e **não** devolve o tamanho da conta que
publicou. Além disso retorna apenas mídia das últimas 24 horas, com teto de 30
hashtags únicas por semana.

Sem views não dá para identificar o que viralizou. Sem seguidores do autor não dá
para calcular engajamento relativo ao tamanho da conta. Sem janela histórica não
dá para achar vencedores passados.

O bloqueio é da plataforma, não do código. A saída é a que já está construída:
semear hipóteses, medir os próprios posts, e deixar os vencedores virarem
template — que é o que a spec sempre quis dizer com *"todo post vencedor volta ao
swipe file"*.

---

## Custo recorrente a vigiar

Cada geração é uma chamada paga por token, e o Workflow A rodando diariamente
acumula. Antes de ativar qualquer cron, defina um teto em **console.anthropic.com
→ Settings → Limits**. O Fal cobra por imagem e por segundo de vídeo; o Kling é
a parte cara.
