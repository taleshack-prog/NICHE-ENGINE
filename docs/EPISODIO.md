# Produzir um episódio

Um episódio é um **arquivo de pauta** em `pautas/`. Não existe mais script
Python por episódio: o montador é um só e lê a pauta.

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

As regras são aproximação, não verdade: `--forcar` monta por cima delas. Se
uma regra errar, o conserto é na regra, não no hábito de ignorá-la.

```bash
python3 -m unittest discover -s tests    # cada regra contra o erro que pega
```

## O que ainda é manual

Gravar a voz, escolher a trilha, escrever a pauta, publicar. O resto é
comando.
