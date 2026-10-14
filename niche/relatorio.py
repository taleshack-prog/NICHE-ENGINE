#!/usr/bin/env python3
"""
A pauta descrita em JSON — o que o dashboard lê.

POR QUE O PYTHON DECIDE E A TELA SÓ MOSTRA: as quatro regras, a conta de
sílabas e a repartição da duração vivem aqui. Reimplementar isso em TypeScript
para a tela criaria duas versões da mesma regra, que divergem no primeiro
conserto — e aí o dashboard aprovaria uma pauta que a montagem recusa.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import linter
from .montagem import cronometrar, durar_blocos
from .pauta import Pauta, PautaInvalida, carregar
from .proveniencia import RAIZ, carregar as carregar_modulo

PASTA_PAUTAS = RAIZ / "pautas"
PASTA_RENDERS = RAIZ / "renders"


def video_de(slug: str) -> Path:
    return PASTA_RENDERS / f"{slug}.mp4"


def estado(p: Pauta, achados: list[linter.Achado]) -> str:
    """
    rascunho → pronta → montada → publicada.

    O estado é DERIVADO: não existe campo de status para alguém esquecer de
    atualizar. Tem erro de linter, é rascunho; tem arquivo de vídeo, montada;
    tem url de publicação, publicada.
    """
    if p.publicacao.get("url"):
        return "publicada"
    if video_de(p.arquivo.stem).exists():
        return "montada"
    if linter.erros(achados):
        return "rascunho"
    return "pronta"


def _relativo(arquivo: Path) -> str:
    """Caminho a partir da raiz do repo, venha ele relativo ou absoluto."""
    a = arquivo.resolve()
    try:
        return str(a.relative_to(RAIZ))
    except ValueError:
        return str(a)


def resumo(arquivo: Path) -> dict[str, Any]:
    """O cartão de um episódio na lista. Nunca estoura: pauta quebrada vira
    um cartão com o defeito escrito, em vez de derrubar a tela inteira."""
    try:
        p = carregar(arquivo)
    except (PautaInvalida, Exception) as e:  # noqa: BLE001
        return {
            "slug": arquivo.stem,
            "arquivo": _relativo(arquivo),
            "titulo": arquivo.stem,
            "estado": "quebrada",
            "defeito": str(e),
            "achados": [], "erros": 1, "avisos": 0,
        }

    achados = linter.conferir(p)
    medidas = durar_blocos(p, None, False)
    linha = cronometrar(p, medidas)
    mn = carregar_modulo("montar_neuroart")
    video = video_de(arquivo.stem)
    return {
        "slug": arquivo.stem,
        "arquivo": _relativo(arquivo),
        "titulo": p.titulo,
        "angulo": p.angulo,
        "estado": estado(p, achados),
        "blocos": len(p.blocos),
        "planos": len(linha),
        "segundos": round(sum(d for _, d, _, _ in linha), 1),
        "segundos_falados": round(
            sum(mn.silabas(b.corrido) for b in p.blocos) / p.ritmo_fala, 1),
        "fontes": [
            {"apelido": f.apelido, "titulo": f.titulo, "onde": f.onde, "url": f.url}
            for f in p.fontes.values()
        ],
        "achados": [
            {"grau": a.grau, "regra": a.regra, "onde": a.onde, "texto": a.texto}
            for a in achados
        ],
        "erros": len(linter.erros(achados)),
        "avisos": len(achados) - len(linter.erros(achados)),
        "publicacao": p.publicacao,
        "video": _relativo(video) if video.exists() else None,
        "precisa_obras": bool(p.obras),
        "precisa_ilustracoes": any(
            v.strip().lower().startswith("ilustra")
            for b in p.blocos for v in b.visuais),
    }


def detalhe(arquivo: Path) -> dict[str, Any]:
    """O resumo mais o conteúdo: a fala de cada bloco e a régua de planos."""
    base = resumo(arquivo)
    if base["estado"] == "quebrada":
        base["yaml"] = arquivo.read_text(encoding="utf-8")
        return base

    p = carregar(arquivo)
    mn = carregar_modulo("montar_neuroart")
    medidas = durar_blocos(p, None, False)
    linha = cronometrar(p, medidas)

    base["yaml"] = arquivo.read_text(encoding="utf-8")
    base["blocos_detalhe"] = [
        {
            "n": i,
            "fala": b.corrido,
            "fonte": b.fonte,
            "segundos": round(mn.silabas(b.corrido) / p.ritmo_fala, 1),
            "cortes": b.legendas,
        }
        for i, b in enumerate(p.blocos, start=1)
    ]
    inicio, planos = 0.0, []
    for n, dur, spec, legenda in linha:
        planos.append({
            "bloco": n, "inicio": round(inicio, 2), "segundos": round(dur, 2),
            "visual": spec, "legenda": legenda,
            "linhas": len(mn.quebrar(legenda.upper(), mn.fonte(54),
                                     mn.SEGURO_LARGURA)) if legenda else 0,
        })
        inicio += dur
    base["linha"] = planos
    return base


def listar() -> list[dict[str, Any]]:
    if not PASTA_PAUTAS.exists():
        return []
    return [resumo(a) for a in sorted(PASTA_PAUTAS.glob("*.yml"))]


def despejar(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)
