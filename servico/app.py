#!/usr/bin/env python3
"""
O pacote `niche` exposto como API — é o que roda no Railway.

POR QUE EXISTE: a Vercel não tem Python com pillow, não tem ffmpeg e tem
sistema de arquivos somente leitura. O dashboard precisa das três coisas:
medir a legenda com a fonte real, renderizar o vídeo e guardar a pauta. Então
a tela fica na Vercel e tudo que toca disco ou binário fica aqui, num
contêiner com volume.

O QUE ESTE ARQUIVO NÃO FAZ: nenhuma regra. Ele chama as mesmas funções que a
linha de comando chama. Se uma regra precisar mudar, muda em `niche/`, e os
dois caminhos mudam juntos — que é a razão de a tela nunca ter reimplementado
o linter em TypeScript.

    uvicorn servico.app:api --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import os
import re
import secrets
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from niche import lugares, modelo, publicacao, relatorio, voz  # noqa: E402
from niche.pauta import PautaInvalida, carregar  # noqa: E402

api = FastAPI(title="niche", docs_url=None, redoc_url=None)

# Tipos de imagem que o montador sabe abrir. A checagem é por conteúdo também,
# mais abaixo: extensão é o que o cliente diz, não o que o arquivo é.
EXTENSOES = {".jpg", ".jpeg", ".png", ".webp"}
TAMANHO_MAXIMO = 40 * 1024 * 1024
NOME_VALIDO = re.compile(r"^[\w-]{1,80}$")


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def autorizar(authorization: str = Header(default="")) -> None:
    """
    Token compartilhado com a Vercel.

    O serviço fica aberto na internet e grava arquivo em disco: sem isto,
    qualquer um cria pauta, dispara render e enche o volume. `compare_digest`
    em vez de `==` porque comparação de string vaza o tamanho do prefixo
    certo pelo tempo de resposta.
    """
    esperado = os.environ.get("NICHE_TOKEN", "")
    if not esperado:
        raise HTTPException(500, "NICHE_TOKEN não configurado no serviço")
    enviado = authorization.removeprefix("Bearer ").strip()
    if not secrets.compare_digest(enviado, esperado):
        raise HTTPException(401, "token inválido")


def caminho(slug: str) -> Path:
    """O slug vem da URL e vira caminho: sem esta checagem, `..%2f..` lê o
    volume inteiro."""
    if not NOME_VALIDO.match(slug):
        raise HTTPException(400, f"nome inválido: {slug}")
    arquivo = lugares.PAUTAS / f"{slug}.yml"
    if arquivo.parent != lugares.PAUTAS:
        raise HTTPException(400, "caminho fora de pautas/")
    return arquivo


@api.on_event("startup")
def preparar() -> None:
    lugares.garantir()


@api.get("/saude")
def saude() -> dict[str, Any]:
    """Diz o que o contêiner TEM, não só que está de pé.

    Um serviço que responde 200 e não tem ffmpeg falha só na primeira
    montagem, três minutos depois, com erro de subprocesso."""
    def versao(cmd: list[str]) -> str | None:
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            return r.stdout.splitlines()[0] if r.returncode == 0 else None
        except Exception:  # noqa: BLE001
            return None

    try:
        import matplotlib  # noqa: F401
        tem_mpl = True
    except Exception:  # noqa: BLE001
        tem_mpl = False

    from niche.proveniencia import carregar as _c
    mn = _c("montar_neuroart")
    return {
        "ok": True,
        "ffmpeg": versao(["ffmpeg", "-version"]),
        "ffprobe": versao(["ffprobe", "-version"]),
        "matplotlib": tem_mpl,
        "fonte": str(mn.FONTE_ARQ) if mn.FONTE_ARQ else None,
        "pautas": len(list(lugares.PAUTAS.glob("*.yml"))),
        "obras": len([p for p in lugares.OBRAS.glob("*") if p.is_file()]),
        "ilustracoes": len([p for p in lugares.ILUSTRA.glob("*") if p.is_file()]),
        "renders": len(list(lugares.RENDERS.glob("*.mp4"))),
        # Sem isto o botão "Entregar pronto" só falharia na hora de
        # narrar, depois de o usuário já estar esperando.
        "voz": voz.disponivel(),
        "voz_modelo": voz.MODELO,
        "voz_nome": voz.VOZ_PADRAO,
    }


# ── pautas ───────────────────────────────────────────────────────────────────


@api.get("/pautas", dependencies=[Depends(autorizar)])
def listar() -> list[dict[str, Any]]:
    return relatorio.listar()


@api.post("/pautas", dependencies=[Depends(autorizar)], status_code=201)
def criar(corpo: dict = Body(...)) -> dict[str, Any]:
    titulo = str(corpo.get("titulo", "")).strip()
    if not titulo:
        raise HTTPException(400, "faltou o título")
    try:
        destino = modelo.criar(lugares.PAUTAS, titulo, corpo.get("slug"))
    except FileExistsError as e:
        raise HTTPException(409, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return relatorio.detalhe(destino)


@api.get("/pautas/{slug}", dependencies=[Depends(autorizar)])
def ver(slug: str) -> dict[str, Any]:
    arquivo = caminho(slug)
    if not arquivo.exists():
        raise HTTPException(404, "não existe")
    return relatorio.detalhe(arquivo)


@api.put("/pautas/{slug}", dependencies=[Depends(autorizar)])
def salvar(slug: str, corpo: dict = Body(...)) -> dict[str, Any]:
    conteudo = corpo.get("yaml")
    if not isinstance(conteudo, str):
        raise HTTPException(400, "faltou o campo yaml")
    arquivo = caminho(slug)
    arquivo.write_text(conteudo, encoding="utf-8")
    return relatorio.detalhe(arquivo)


@api.delete("/pautas/{slug}", dependencies=[Depends(autorizar)])
def apagar(slug: str) -> dict[str, Any]:
    arquivo = caminho(slug)
    if not arquivo.exists():
        raise HTTPException(404, "não existe")
    arquivo.unlink()
    # O mp4 fica: render custa minutos, e um clique errado não pode custar
    # isso. Quem quiser apagar o vídeo apaga pelo acervo.
    return {"apagada": slug}


@api.post("/pautas/{slug}/publicar", dependencies=[Depends(autorizar)])
def publicar(slug: str, corpo: dict = Body(...)) -> dict[str, Any]:
    arquivo = caminho(slug)
    if not arquivo.exists():
        raise HTTPException(404, "não existe")
    try:
        publicacao.gravar(arquivo, corpo)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"não gravei: {e}") from e
    return relatorio.detalhe(arquivo)


@api.post("/conferir", dependencies=[Depends(autorizar)])
def conferir(corpo: dict = Body(...)) -> dict[str, Any]:
    """Passa um YAML pelo linter SEM gravar — é o que permite olhar uma
    proposta de IA antes de ela encostar no arquivo."""
    conteudo = corpo.get("yaml")
    if not isinstance(conteudo, str):
        raise HTTPException(400, "faltou o campo yaml")
    import tempfile

    tmp = Path(tempfile.mkstemp(suffix=".yml", prefix="proposta-")[1])
    try:
        tmp.write_text(conteudo, encoding="utf-8")
        return relatorio.detalhe(tmp)
    except PautaInvalida as e:
        raise HTTPException(400, str(e)) from e
    finally:
        tmp.unlink(missing_ok=True)


# ── montagem ─────────────────────────────────────────────────────────────────


@api.post("/pautas/{slug}/montar", dependencies=[Depends(autorizar)])
def montar(slug: str, corpo: dict = Body(default={})) -> dict[str, Any]:
    """
    Dispara o render em processo destacado e devolve o id do trabalho.

    O render passa de três minutos; uma requisição não pode esperar por ele.
    Quem grava o desfecho é o shell, num arquivo `.code`, e não um ouvinte
    neste processo: o contêiner pode ser reiniciado pelo Railway no meio, e
    um trabalho ficaria "rodando" para sempre.
    """
    arquivo = caminho(slug)
    if not arquivo.exists():
        raise HTTPException(404, "não existe")

    d = relatorio.detalhe(arquivo)
    if d["erros"] and not corpo.get("forcar"):
        raise HTTPException(409, f"a pauta tem {d['erros']} erro(s) de linter")

    lugares.garantir()
    saida = lugares.RENDERS / f"{slug}.mp4"

    # `entregar` é o mesmo render com a narração gerada antes e os tempos
    # vindos da medição dela. É um comando separado porque GASTA: quem clica
    # em montar não pode ser surpreendido por uma conta.
    entregar = bool(corpo.get("entregar"))
    if entregar and not voz.disponivel():
        raise HTTPException(
            503,
            "FAL_KEY não está no ambiente do serviço — sem ela não há como "
            "gerar a narração. Configure no Railway e faça o deploy de novo.",
        )

    args = [sys.executable, "-u", "-m", "niche",
            "entregar" if entregar else "montar", str(arquivo),
            "--saida", str(saida)]
    if d.get("precisa_obras"):
        args += ["--obras", str(lugares.OBRAS)]
    if d.get("precisa_ilustracoes"):
        args += ["--ilustra", str(lugares.ILUSTRA)]

    audio = [("--trilha", "trilha")] if entregar else [("--voz", "voz"),
                                                       ("--trilha", "trilha")]
    for bandeira, chave in audio:
        nome = corpo.get(chave)
        if nome:
            alvo = lugares.OBRAS.parent / "audio" / str(nome)
            if not alvo.exists():
                raise HTTPException(400, f"não achei {chave}: {nome}")
            args += [bandeira, str(alvo)]

    if entregar:
        if corpo.get("voz_nome"):
            args += ["--voz-nome", str(corpo["voz_nome"])]
    elif corpo.get("tempos"):
        # Com narração gerada os tempos vêm da medição; aceitar os dois seria
        # deixar um valor digitado sobrescrever a medida exata.
        args += ["--tempos", str(corpo["tempos"])]
    if corpo.get("forcar"):
        args.append("--forcar")

    ident = str(uuid.uuid4())
    base = lugares.TRABALHOS / ident
    base.with_suffix(".log").write_text(" ".join(args) + "\n", encoding="utf-8")
    trabalho = {"id": ident, "slug": slug, "estado": "rodando",
                "inicio": _agora(), "saida": f"{slug}.mp4"}
    base.with_suffix(".json").write_text(
        __import__("json").dumps(trabalho, ensure_ascii=False), encoding="utf-8")

    citar = lambda s: "'" + s.replace("'", "'\\''") + "'"  # noqa: E731
    linha = (" ".join(citar(a) for a in args)
             + f" >> {citar(str(base.with_suffix('.log')))} 2>&1; "
             + f"echo $? > {citar(str(base.with_suffix('.code')))}")
    subprocess.Popen(["/bin/sh", "-c", linha], cwd=RAIZ, start_new_session=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL)
    return trabalho


@api.get("/trabalhos/{ident}", dependencies=[Depends(autorizar)])
def trabalho(ident: str) -> dict[str, Any]:
    import json

    if not re.match(r"^[\w-]{10,80}$", ident):
        raise HTTPException(400, "id inválido")
    base = lugares.TRABALHOS / ident
    if not base.with_suffix(".json").exists():
        raise HTTPException(404, "trabalho desconhecido")
    dados = json.loads(base.with_suffix(".json").read_text(encoding="utf-8"))
    log = base.with_suffix(".log")
    if base.with_suffix(".code").exists():
        codigo = base.with_suffix(".code").read_text(encoding="utf-8").strip()
        dados["estado"] = "concluido" if codigo == "0" else "falhou"
        if codigo != "0":
            dados["saida"] = None
    return {"trabalho": dados,
            "log": log.read_text(encoding="utf-8") if log.exists() else ""}


@api.get("/renders/{slug}.mp4", dependencies=[Depends(autorizar)])
def video(slug: str, range: str = Header(default="")) -> Response:
    """
    Serve o mp4 com suporte a Range.

    Sem Range o <video> baixa os 11 MB antes do primeiro quadro e não deixa
    arrastar a linha do tempo — que é justamente o que se faz ao conferir se a
    legenda caiu no lugar certo.
    """
    if not NOME_VALIDO.match(slug):
        raise HTTPException(400, "nome inválido")
    arquivo = lugares.RENDERS / f"{slug}.mp4"
    if not arquivo.exists():
        raise HTTPException(404, "ainda não montado")
    tamanho = arquivo.stat().st_size

    if range.startswith("bytes="):
        cru = range.removeprefix("bytes=").split("-")
        inicio = int(cru[0] or 0)
        fim = int(cru[1]) if len(cru) > 1 and cru[1] else tamanho - 1
        fim = min(fim, tamanho - 1)
        with arquivo.open("rb") as f:
            f.seek(inicio)
            pedaco = f.read(fim - inicio + 1)
        return Response(pedaco, status_code=206, media_type="video/mp4",
                        headers={"Content-Range": f"bytes {inicio}-{fim}/{tamanho}",
                                 "Accept-Ranges": "bytes"})
    return FileResponse(arquivo, media_type="video/mp4",
                        headers={"Accept-Ranges": "bytes"})


# ── acervo ───────────────────────────────────────────────────────────────────

PASTAS_ACERVO = {"obras": lambda: lugares.OBRAS,
                 "ilustra": lambda: lugares.ILUSTRA,
                 "audio": lambda: lugares.OBRAS.parent / "audio"}


@api.get("/acervo", dependencies=[Depends(autorizar)])
def acervo() -> dict[str, list[dict[str, Any]]]:
    saida = {}
    for tipo, pasta in PASTAS_ACERVO.items():
        p = pasta()
        p.mkdir(parents=True, exist_ok=True)
        saida[tipo] = [
            {"nome": a.name, "bytes": a.stat().st_size}
            for a in sorted(p.iterdir()) if a.is_file()
        ]
    return saida


@api.post("/acervo/{tipo}", dependencies=[Depends(autorizar)], status_code=201)
async def enviar(tipo: str, arquivo: UploadFile) -> dict[str, Any]:
    """
    Recebe obra, ilustração ou trilha.

    As obras NÃO vão para o git: 22 MB de arte em histórico de repositório é
    dívida permanente, e cada episódio novo traz arte nova. Ficam no volume.
    """
    if tipo not in PASTAS_ACERVO:
        raise HTTPException(400, f"tipo desconhecido: {tipo}")
    nome = Path(arquivo.filename or "").name
    if not nome or nome.startswith("."):
        raise HTTPException(400, "nome de arquivo inválido")
    extensao = Path(nome).suffix.lower()
    if tipo != "audio" and extensao not in EXTENSOES:
        raise HTTPException(400, f"extensão não suportada: {extensao}")

    pasta = PASTAS_ACERVO[tipo]()
    pasta.mkdir(parents=True, exist_ok=True)
    destino = pasta / nome
    tamanho = 0
    with destino.open("wb") as saida:
        while pedaco := await arquivo.read(1 << 20):
            tamanho += len(pedaco)
            if tamanho > TAMANHO_MAXIMO:
                saida.close()
                destino.unlink(missing_ok=True)
                raise HTTPException(413, "arquivo acima de 40 MB")
            saida.write(pedaco)

    # Imagem é CONFERIDA abrindo: extensão é o que o cliente diz, e um arquivo
    # que não abre só apareceria três minutos depois, no meio do render.
    if tipo != "audio":
        try:
            from PIL import Image

            with Image.open(destino) as img:
                img.verify()
            with Image.open(destino) as img:
                largura, altura = img.size
        except Exception as e:  # noqa: BLE001
            destino.unlink(missing_ok=True)
            raise HTTPException(400, f"não consegui abrir como imagem: {e}") from e
        return {"nome": nome, "bytes": tamanho, "largura": largura, "altura": altura}
    return {"nome": nome, "bytes": tamanho}


@api.delete("/acervo/{tipo}/{nome}", dependencies=[Depends(autorizar)])
def remover(tipo: str, nome: str) -> dict[str, Any]:
    if tipo not in PASTAS_ACERVO:
        raise HTTPException(400, f"tipo desconhecido: {tipo}")
    limpo = Path(nome).name
    alvo = PASTAS_ACERVO[tipo]() / limpo
    if not alvo.exists() or not alvo.is_file():
        raise HTTPException(404, "não existe")
    alvo.unlink()
    return {"removido": limpo}


@api.exception_handler(PautaInvalida)
def pauta_invalida(_req, exc: PautaInvalida) -> JSONResponse:
    return JSONResponse({"erro": str(exc)}, status_code=400)


def principal() -> None:
    import uvicorn

    uvicorn.run(api, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))


if __name__ == "__main__":
    principal()
