import { TituloPagina } from "@/components/layout/casca";
import { Card, CardCabecalho, CardConteudo, CardTitulo } from "@/components/ui/card";

const REGRAS = [
  {
    nome: "ângulo",
    cobra: "tese, não tema",
    veio: "o episódio 2 nasceu como “os quatro pilares científicos”, uma lista — até a pesquisa mostrar que só um dos quatro tem meta-análise por trás. Com tese, a ordem muda e o episódio tem o que dizer.",
  },
  {
    nome: "fala",
    cobra: "respiração corrida; legenda que cabe na tela",
    veio: "a primeira versão do roteiro do episódio 1 eram onze sentenças fechadas, uma por legenda. A gravação travou: “as frases estão muito duras, não conectam”. A legenda é medida com a fonte real dentro da zona segura do player.",
  },
  {
    nome: "produto",
    cobra: "entregue no presente, roadmap marcado como roadmap",
    veio: "a interface cérebro-computador entrou escrita como pilar existente. Afirmar entrega que não existe custa o canal, não só a credibilidade.",
  },
  {
    nome: "fonte",
    cobra: "número declara de onde veio",
    veio: "“dezoito estudos, quase quinhentas crianças” é verificável ou é invenção, e a diferença não aparece no vídeo. Número do próprio projeto usa fonte: produto.",
  },
  {
    nome: "esqueleto",
    cobra: "pauta nova precisa ser escrita",
    veio: "o modelo criado pelo botão PASSAVA no linter: o texto-lembrete tem mais de 40 caracteres e não repete o título, que é tudo o que a regra do ângulo consegue medir sozinha. Rascunho aprovado ensina a preencher placeholder.",
  },
];

const VISUAIS: [string, string][] = [
  ["obra:chave[,panorâmica]", "a obra na tela, com deriva lateral"],
  ["detalhe:chave,zona[,aperto]", "recorte da obra — zona 0 é o topo, 1 é a base"],
  ["placa:TÍTULO|DESTAQUE|RODAPÉ", "placa tipográfica; 4º campo é a cor"],
  ["ilustra:arquivo.png", "ilustração quadrada sobre fundo escuro"],
  ["floresta", "o forest plot se formando"],
  ["grades · divisao · etiquetas · fecho", "os planos fixos do episódio 1"],
];

export default function PaginaManual() {
  return (
    <div className="max-w-3xl space-y-6">
      <TituloPagina
        titulo="Como funciona"
        descricao="Um episódio é um arquivo YAML em pautas/. O montador é um só."
      />

      <Card>
        <CardCabecalho>
          <CardTitulo>A fala e os cortes</CardTitulo>
        </CardCabecalho>
        <CardConteudo className="space-y-3 text-sm leading-relaxed text-suave">
          <p>
            Cada bloco é <strong className="text-texto">uma respiração</strong>, escrita
            corrida, do jeito que se lê em voz alta. As barras marcam onde a{" "}
            <strong className="text-texto">legenda</strong> corta — não onde a frase termina.
          </p>
          <pre className="overflow-x-auto rounded-md bg-fundo p-3 font-mono text-xs text-tenue">
{`- fonte: meta-analise
  fala: >
    Testaram vários tipos de exercício em crianças autistas /
    medindo controle inibitório /
    Dezoito estudos, quase quinhentas crianças
  visuais:
    - placa:META-ANÁLISE|18 estudos|exercício e controle inibitório
    - placa:PARTICIPANTES|499 crianças|8 ensaios randomizados
    - floresta#0-0.25`}
          </pre>
          <p>
            Um corte escrito <code className="text-texto">-</code> é plano sem legenda: a
            imagem entra para ser vista e ganha 1,8s fixos. Tem que haver{" "}
            <strong className="text-texto">um visual por corte</strong>, na ordem.
          </p>
        </CardConteudo>
      </Card>

      <Card>
        <CardCabecalho>
          <CardTitulo>Visuais</CardTitulo>
        </CardCabecalho>
        <CardConteudo className="space-y-2">
          {VISUAIS.map(([sintaxe, oque]) => (
            <div key={sintaxe} className="flex flex-wrap items-baseline gap-x-3 text-xs">
              <code className="font-mono text-roxo">{sintaxe}</code>
              <span className="text-tenue">{oque}</span>
            </div>
          ))}
          <p className="pt-2 text-xs leading-relaxed text-suave">
            Qualquer um aceita <code className="text-texto">#início-fim</code>:{" "}
            <code className="text-roxo">floresta#0.25-0.60</code> continua a animação de onde{" "}
            <code className="text-roxo">floresta#0-0.25</code> parou, em vez de recomeçar.
          </p>
        </CardConteudo>
      </Card>

      <Card>
        <CardCabecalho>
          <CardTitulo>As quatro regras</CardTitulo>
          <p className="text-xs text-tenue">
            Erro barra a montagem; aviso não. Cada uma existe por causa de um erro que já
            aconteceu aqui.
          </p>
        </CardCabecalho>
        <CardConteudo className="space-y-3">
          {REGRAS.map((r) => (
            <div key={r.nome} className="rounded-md border border-borda p-3">
              <p className="text-sm font-medium text-texto">
                {r.nome} <span className="font-normal text-tenue">— {r.cobra}</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-suave">{r.veio}</p>
            </div>
          ))}
          <p className="text-xs leading-relaxed text-tenue">
            As regras são aproximação, não verdade. Quando uma errar, o botão “montar assim
            mesmo” passa por cima — e o conserto é na regra, não no hábito de ignorá-la.
          </p>
        </CardConteudo>
      </Card>

      <Card>
        <CardCabecalho>
          <CardTitulo>O que custa dinheiro</CardTitulo>
        </CardCabecalho>
        <CardConteudo className="space-y-2 text-sm leading-relaxed text-suave">
          <p>
            Só uma coisa: <strong className="text-texto">rascunhar ou corrigir a
            pauta com IA</strong>. Linter, régua de tempo, montagem, mistura e
            publicação são código determinístico e custam zero, quantas vezes você
            rodar.
          </p>
          <p>
            Os dois botões de IA mostram a conta <em>antes</em> de gastar, em tokens,
            e o número real depois da chamada. O valor em dólar só aparece se você
            definir <code className="text-texto">ANTHROPIC_PRECO_ENTRADA_USD</code> e{" "}
            <code className="text-texto">ANTHROPIC_PRECO_SAIDA_USD</code> no{" "}
            <code className="text-texto">.env</code> — não embuti tabela de preço no
            código porque ela envelhece sem avisar e o preço do seu contrato pode não
            ser o da tabela.
          </p>
          <p className="text-tenue">
            A correção nunca grava sozinha: ela volta como proposta, já passada pelo
            linter, e quem aceita é você.
          </p>
        </CardConteudo>
      </Card>

      <Card>
        <CardCabecalho>
          <CardTitulo>Pelo terminal</CardTitulo>
          <p className="text-xs text-tenue">O dashboard chama exatamente isto.</p>
        </CardCabecalho>
        <CardConteudo>
          <pre className="overflow-x-auto rounded-md bg-fundo p-3 font-mono text-xs text-suave">
{`python3 -m niche novo         "Título do episódio"
python3 -m niche validar      pautas/03-novo.yml
python3 -m niche falar        pautas/03-novo.yml
python3 -m niche sincronizar  pautas/03-novo.yml voz.ogg
python3 -m niche montar       pautas/03-novo.yml --saida renders/03.mp4 \\
    --obras ~/obras --ilustra ~/ilustra --trilha trilha.mp3
python3 -m niche publicar     pautas/03-novo.yml --dados '{"url":"..."}'`}
          </pre>
        </CardConteudo>
      </Card>
    </div>
  );
}
