import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth";
import { IAIndisponivelError } from "@/lib/ai";
import {
  conferirYaml,
  criarPauta,
  salvarPauta,
  verEpisodio,
  type Episodio,
} from "@/lib/niche";
import {
  estimar,
  gerar,
  modeloDoRoteiro,
  precoConfigurado,
  promptDeCorrecao,
  promptDeRascunho,
} from "@/lib/pauta-ia";
import { diagnosticarChave, emTexto } from "@/lib/diagnostico-ia";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Corpo = {
  acao: "estimar-rascunho" | "rascunhar" | "estimar-correcao" | "corrigir";
  titulo?: string;
  tema?: string;
  fontes?: string;
  segundos?: number;
  slug?: string;
  yaml?: string;
};

/**
 * A única rota paga do dashboard do canal.
 *
 * As ações `estimar-*` NÃO chamam a API: montam o prompt e contam os
 * caracteres. Existem para a conta aparecer antes de ser gasta — o botão só
 * gasta depois que o número está na tela.
 */
export async function POST(req: Request) {
  await exigirSessao();
  const c = (await req.json()) as Corpo;

  try {
    if (c.acao === "estimar-rascunho" || c.acao === "rascunhar") {
      if (!c.titulo?.trim()) {
        return NextResponse.json({ erro: "faltou o título" }, { status: 400 });
      }
      const prompt = await promptDeRascunho({
        titulo: c.titulo.trim(),
        tema: (c.tema ?? "").trim(),
        fontes: (c.fontes ?? "").trim(),
        segundos: c.segundos ?? 70,
      });

      if (c.acao === "estimar-rascunho") {
        return NextResponse.json({
          uso: estimar(prompt),
          precoConfigurado: Boolean(precoConfigurado()),
        });
      }

      // O arquivo nasce pelo `niche novo` — mesmo esqueleto do botão em
      // branco — e só depois recebe o texto da IA. Se a geração falhar, o
      // episódio existe e é editável à mão, em vez de nada ter acontecido.
      const criado = await criarPauta(c.titulo.trim());
      const { texto, uso } = await gerar(prompt);

      let episodio: Episodio;
      let aviso: string | null = null;
      try {
        await conferirYaml(texto);
        episodio = await salvarPauta(criado.slug, texto);
      } catch (e) {
        aviso =
          "o rascunho saiu com YAML inválido e NÃO foi gravado; " +
          `o episódio ficou com o esqueleto. (${(e as Error).message})`;
        episodio = await verEpisodio(criado.slug);
      }
      return NextResponse.json({ episodio, uso, aviso, proposta: texto });
    }

    if (c.acao === "estimar-correcao" || c.acao === "corrigir") {
      if (!c.slug || typeof c.yaml !== "string") {
        return NextResponse.json({ erro: "faltou slug ou yaml" }, { status: 400 });
      }
      const atual = await conferirYaml(c.yaml);
      const achados = atual.achados.map((a) => `[${a.regra}] ${a.onde}: ${a.texto}`);
      if (achados.length === 0) {
        // 409 porque a ação não pode seguir, mas isto NÃO é falha: a pauta
        // está limpa. `informativo` existe para o editor não pintar a tarja
        // vermelha de erro numa boa notícia — o botão apenas se recusou a
        // gastar token para corrigir o que já passou nas regras.
        return NextResponse.json(
          {
            erro: "o linter não apontou nada — não há o que corrigir",
            informativo: true,
          },
          { status: 409 },
        );
      }
      const prompt = promptDeCorrecao(c.yaml, achados);

      if (c.acao === "estimar-correcao") {
        return NextResponse.json({
          uso: estimar(prompt, 2200),
          precoConfigurado: Boolean(precoConfigurado()),
          achados: achados.length,
        });
      }

      // A correção NÃO grava: volta como proposta, com os achados do que ela
      // ficou sendo. Quem aceita é o usuário, no editor.
      const { texto, uso } = await gerar(prompt);
      let depois: Episodio | null = null;
      let aviso: string | null = null;
      try {
        depois = await conferirYaml(texto);
      } catch (e) {
        aviso = `a proposta veio com YAML inválido: ${(e as Error).message}`;
      }
      return NextResponse.json({ proposta: texto, depois, uso, aviso });
    }

    return NextResponse.json({ erro: "ação desconhecida" }, { status: 400 });
  } catch (e) {
    if (e instanceof IAIndisponivelError) {
      return NextResponse.json(
        {
          erro:
            "ANTHROPIC_API_KEY não está no .env. Edite o arquivo pelo editor e " +
            "reinicie o servidor — o Next lê o .env só na inicialização.",
        },
        { status: 503 },
      );
    }
    // 401/404 da Anthropic chegam aqui como texto cru de JSON ("invalid
    // x-api-key"), que não diz O QUE corrigir. Aqui a própria rota investiga:
    // /v1/models é de graça e responde as duas perguntas possíveis — a chave
    // vale? o modelo existe nesta conta?
    const msg = (e as Error).message;
    if (/\b401\b|authentication_error|invalid x-api-key/i.test(msg)) {
      const d = await diagnosticarChave(modeloDoRoteiro());
      return NextResponse.json({ erro: emTexto(d), diagnostico: d }, { status: 401 });
    }
    if (/\b404\b|not_found_error/i.test(msg)) {
      const d = await diagnosticarChave(modeloDoRoteiro());
      return NextResponse.json({ erro: emTexto(d), diagnostico: d }, { status: 404 });
    }
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
}
