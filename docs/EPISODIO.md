# Produzir um episódio

Um episódio é um **arquivo de pauta** em `pautas/`. Não existe mais script
Python por episódio: o montador é um só e lê a pauta.

## Pelo navegador

```bash
npm run dev     # http://localhost:3000/youtube
```

Lá dá para criar o episódio, escrever a pauta com o linter apontando bloco a
bloco, ler a fala em formato teleprompter, montar, assistir ao resultado e
guardar título, descrição e link da publicação. Nada disso chama a API de IA.

A **única** ação paga é rascunhar ou corrigir a pauta com IA, e ela mostra a
conta em tokens antes de gastar. Para ver o valor em dólar, defina no `.env`:

```
ANTHROPIC_PRECO_ENTRADA_USD=...   # por milhão de tokens
ANTHROPIC_PRECO_SAIDA_USD=...
```

Não há tabela de preço embutida no código de propósito: ela envelhece sozinha
e o preço do seu contrato pode não ser o da tabela. Os valores correntes estão
em <https://platform.claude.com/docs/en/about-claude/pricing>.

## Pelo terminal

```bash
python3 -m niche validar      pautas/03-novo.yml
python3 -m niche falar        pautas/03-novo.yml           # texto para gravar
python3 -m niche sincronizar  pautas/03-novo.yml voz.ogg   # mede a gravação
python3 -m niche montar       pautas/03-novo.yml --saida ep3.mp4 \
    --obras ~/obras --ilustra ~/ilustra --voz voz.ogg --trilha trilha.mp3 \
    --tempos 9.52,10.11,...
python3 -m niche remixar      pautas/03-novo.yml ep3.mp4 --saida ep3b.mp4 \
    --voz voz.ogg --trilha trilha.mp3 --volume-trilha 0.6
```

E os que o dashboard usa por baixo:

```bash
python3 -m niche novo "Título do episódio"      # cria o esqueleto
python3 -m niche listar                         # todas as pautas, em JSON
python3 -m niche ver pautas/03-novo.yml         # uma pauta, com a régua de planos
cat proposta.yml | python3 -m niche ver -       # confere sem gravar
python3 -m niche publicar pautas/03-novo.yml \
    --dados '{"titulo":"...","url":"https://youtube.com/shorts/..."}'
```

`publicar` troca **só** o bloco `publicacao:` do arquivo: os comentários da
pauta ficam onde estão, e o resultado é conferido como YAML antes de encostar
no disco.

Sem gravação, monte direto: a legenda é cronometrada pelo ritmo de leitura
(4,3 sílabas/s) em vez do de fala (5,4). Foi assim que saiu o episódio 2.

## A pauta

```yaml
titulo: ...
angulo: >                      # a TESE. Sem isto o arquivo não carrega.
fontes:                        # de onde vem cada número
  apelido: {titulo: ..., onde: ..., url: ...}
  produto: {titulo: ...}       # "produto" = dado do próprio projeto
produto:
  entregue: [...]              # o que o projeto JÁ faz
  roadmap:  [...]              # o que ainda não existe
obras:                         # arquivo, título, etiqueta, frações, valor
grafico:                       # opcional: dados do forest plot
blocos:
  - fonte: apelido
    fala: >
      uma respiração escrita corrida / com barras marcando onde a legenda corta
    visuais: [um por corte]
```

A `fala` é **uma respiração**, escrita como se lê em voz alta. As barras
marcam onde a *legenda* corta, não onde a frase termina. Um corte escrito
`-` é plano sem legenda (a imagem entra para ser vista; ganha 1,8s fixos).

## Visuais

    obra:chave[,panoramica]        a obra na tela, com deriva lateral
    detalhe:chave,zona[,aperto]    recorte (zona 0 = topo, 1 = base)
    placa:TÍTULO|DESTAQUE|RODAPÉ   placa tipográfica; 4º campo = cor
    ilustra:arquivo.png            ilustração quadrada sobre fundo escuro
    floresta                       o forest plot se formando
    grades · divisao · etiquetas · fecho

Qualquer um aceita `#inicio-fim`: `floresta#0.25-0.60` continua a animação de
onde `floresta#0-0.25` parou, em vez de recomeçar. Cores da placa: `ciano`
(padrão), `apagado`, `verde`, `violeta`, `texto` — o apagado é o que marca
visualmente um item de roadmap.

## As quatro regras

`validar` e `montar` passam a pauta por elas. **Erro barra a montagem**; aviso
não. Cada uma existe por causa de um erro que já aconteceu nesta operação:

| Regra | O que cobra | De onde veio |
| --- | --- | --- |
| ângulo | tese, não tema | o episódio 2 nasceu como "os quatro pilares", uma lista — até a pesquisa mostrar que só um tem meta-análise |
| fala | respiração corrida, legenda que cabe na tela | a primeira versão do episódio 1 eram onze sentenças fechadas e a gravação travou |
| produto | entregue no presente, roadmap marcado | a interface cérebro-computador entrou escrita como pilar existente |
| fonte | número declara de onde veio | "dezoito estudos, quase quinhentas crianças" esteve no roteiro antes de existir fonte |
| esqueleto | pauta nova precisa ser escrita | o modelo de `niche novo` PASSAVA no linter: o texto-lembrete tem mais de 40 caracteres e não repete o título, que é tudo o que a regra do ângulo mede |

As regras são aproximação, não verdade: `--forcar` monta por cima delas. Se
uma regra errar, o conserto é na regra, não no hábito de ignorá-la.

```bash
python3 -m unittest discover -s tests    # cada regra contra o erro que pega
```

## O que ainda é manual

Gravar a voz, escolher a trilha, decidir o ângulo, e subir o vídeo no YouTube.
O resto é botão.
