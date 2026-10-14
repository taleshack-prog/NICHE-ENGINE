#!/usr/bin/env python3
"""
Traduz a notação de visual da pauta nas funções de desenho que já funcionam.

A NOTAÇÃO, inteira:

    obra:kanji[,panoramica]        a obra na tela, com deriva lateral
    detalhe:kanji,zona[,aperto]    recorte da obra (zona 0=topo, 1=base)
    placa:TÍTULO|DESTAQUE|RODAPÉ   placa tipográfica; 4º campo = cor
    ilustra:arquivo.png            ilustração quadrada sobre fundo escuro
    floresta                       o forest plot se formando
    grades | divisao | etiquetas | fecho

    qualquer um aceita o sufixo #inicio-fim

O SUFIXO É O QUE EVITA DUPLICAR PLANO. `floresta#0-0.25` desenha só o primeiro
quarto da animação; `floresta#0.25-0.60` continua de onde parou. Era isso que
no episódio 2 estava escrito como `lambda t: plano_floresta(0.25 + t * 0.35)` —
aritmética à mão dentro do roteiro, onde um dígito errado passa calado.

Cor da placa: `ciano` (padrão), `apagado`, `verde`, `violeta`, `texto`. O
apagado é o que marca visualmente um item de roadmap — a honestidade entra
como plano, não como ressalva.
"""

from __future__ import annotations

import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .proveniencia import carregar

mn = carregar("montar_neuroart")

Desenho = Callable[[float], "mn.Image.Image"]

_RE_SUFIXO = re.compile(r"#\s*([\d.]+)\s*-\s*([\d.]+)\s*$")


class VisualInvalido(Exception):
    pass


@dataclass
class Contexto:
    """O que os visuais precisam de fora: as obras, as ilustrações, o gráfico."""

    obras: dict[str, "mn.Obra"]
    ilustracoes: Path | None = None
    grafico: dict | None = None

    def obra(self, chave: str) -> "mn.Obra":
        if chave not in self.obras:
            raise VisualInvalido(
                f"obra “{chave}” não existe na pauta (tem: "
                f"{', '.join(sorted(self.obras)) or 'nenhuma'})")
        return self.obras[chave]


# ── ilustração quadrada ──────────────────────────────────────────────────────

_CACHE_ILU: dict[str, "mn.Image.Image"] = {}


def plano_ilustracao(arquivo: Path, t: float) -> "mn.Image.Image":
    """
    Uma ilustração quadrada, centrada no alto, com aproximação lenta.

    POR QUE NÃO PREENCHE A TELA: as ilustrações são 1:1 e a tela é 9:16.
    Recortar para encher cortaria 40% da composição — e nestas o assunto está
    no centro e nas bordas ao mesmo tempo. Sobre o fundo escuro, o quadrado
    inteiro lê como peça exposta, e a faixa de baixo é onde a legenda mora.
    """
    chave = str(arquivo)
    if chave not in _CACHE_ILU:
        if not arquivo.exists():
            raise VisualInvalido(f"ilustração não encontrada: {arquivo}")
        src = mn.Image.open(arquivo).convert("RGB")
        _CACHE_ILU[chave] = src.resize((mn.LARGURA, mn.LARGURA), mn.Image.LANCZOS)
    base = _CACHE_ILU[chave]

    # Aproximação de 4% ao longo do plano: quadrado parado por 2,5s fica morto,
    # e zoom maior denunciaria que é imagem fixa.
    lado = int(mn.LARGURA * (1.0 + 0.04 * t))
    img = mn.tela()
    img.paste(base.resize((lado, lado), mn.Image.LANCZOS),
              ((mn.LARGURA - lado) // 2, int(mn.ALTURA * 0.26)))
    return img


# ── forest plot ──────────────────────────────────────────────────────────────

_TMP = Path(tempfile.mkdtemp(prefix="niche-graficos-"))
_ge = None
_fonte_ge = None


def _floresta(t: float, grafico: dict | None) -> "mn.Image.Image":
    global _ge, _fonte_ge
    if _ge is None:
        _ge = carregar("grafico_efeitos")
        _fonte_ge = _ge.preparar_fonte()

    dados = geral = textos = None
    if grafico:
        linhas = grafico.get("linhas")
        if linhas:
            dados = [_ge.Efeito(l["rotulo"], float(l["smd"]), float(l["baixo"]),
                                float(l["alto"])) for l in linhas]
        g = grafico.get("geral")
        if g:
            geral = _ge.Efeito(g.get("rotulo", "EFEITO GERAL"), float(g["smd"]),
                               float(g["baixo"]), float(g["alto"]))
        textos = {k: v for k, v in grafico.items()
                  if k in ("chapeu", "manchete", "destaque", "notas")}

    destino = _TMP / f"fl-{int(t * 10000):05d}.png"
    _ge.desenhar(t, _fonte_ge, destino, dados, geral, textos)
    img = mn.Image.open(destino).convert("RGB")
    destino.unlink(missing_ok=True)
    return img


# ── o resolver ───────────────────────────────────────────────────────────────

CORES = {
    "ciano": mn.CIANO, "apagado": mn.APAGADO, "verde": mn.VERDE,
    "violeta": mn.VIOLETA, "texto": mn.TEXTO,
}


def _numero(s: str, onde: str) -> float:
    try:
        return float(s)
    except ValueError:
        raise VisualInvalido(f"{onde}: “{s}” não é número")


def resolver(spec: str, ctx: Contexto) -> Desenho:
    """Uma linha de `visuais` vira a função que desenha aquele plano."""
    bruto = spec.strip()
    ini, fim = 0.0, 1.0
    if m := _RE_SUFIXO.search(bruto):
        ini, fim = float(m.group(1)), float(m.group(2))
        bruto = bruto[: m.start()].strip()
        if not 0.0 <= ini <= fim <= 1.0:
            raise VisualInvalido(f"{spec}: o trecho #{ini}-{fim} tem que estar "
                                 f"dentro de 0-1 e em ordem")

    def mapear(t: float) -> float:
        return ini + t * (fim - ini)

    tipo, _, args = bruto.partition(":")
    tipo = tipo.strip().lower()

    if tipo == "obra":
        partes = [a.strip() for a in args.split(",")]
        obra = ctx.obra(partes[0])
        pan = _numero(partes[1], spec) if len(partes) > 1 else 0.5
        return lambda t: mn.plano_obra(obra, mapear(t), pan)

    if tipo == "detalhe":
        partes = [a.strip() for a in args.split(",")]
        if len(partes) < 2:
            raise VisualInvalido(f"{spec}: detalhe precisa de obra e zona, "
                                 f"ex. detalhe:kanji,0.15")
        obra = ctx.obra(partes[0])
        zona = _numero(partes[1], spec)
        aperto = _numero(partes[2], spec) if len(partes) > 2 else 1.0
        return lambda t: mn.plano_detalhe(obra, mapear(t), zona, aperto)

    if tipo == "placa":
        campos = [c.strip() for c in args.split("|")]
        while len(campos) < 3:
            campos.append("")
        titulo, destaque, rodape = campos[0], campos[1], campos[2]
        cor = mn.CIANO
        if len(campos) > 3 and campos[3]:
            if campos[3].lower() not in CORES:
                raise VisualInvalido(f"{spec}: cor “{campos[3]}” não existe "
                                     f"(tem: {', '.join(sorted(CORES))})")
            cor = CORES[campos[3].lower()]
        return lambda t: mn.plano_placa(titulo, destaque, rodape, mapear(t), cor)

    if tipo == "ilustra":
        if ctx.ilustracoes is None:
            raise VisualInvalido(f"{spec}: a pauta usa ilustração, mas não "
                                 f"recebi a pasta (--ilustra)")
        arquivo = ctx.ilustracoes / args.strip()
        return lambda t: plano_ilustracao(arquivo, mapear(t))

    if tipo == "floresta":
        grafico = ctx.grafico
        return lambda t: _floresta(mapear(t), grafico)

    if tipo == "grades":
        return lambda t: mn.plano_grades(mapear(t))
    if tipo == "divisao":
        return lambda t: mn.plano_divisao(mapear(t))
    if tipo == "etiquetas":
        todas = list(ctx.obras.values())
        if not todas:
            raise VisualInvalido(f"{spec}: etiquetas precisa de obras na pauta")
        return lambda t: mn.plano_etiquetas(todas, mapear(t))
    if tipo == "fecho":
        return lambda t: mn.plano_fecho(mapear(t))

    raise VisualInvalido(
        f"{spec}: visual “{tipo}” não existe. Tem: obra, detalhe, placa, "
        f"ilustra, floresta, grades, divisao, etiquetas, fecho")


def limpar() -> None:
    import shutil
    shutil.rmtree(_TMP, ignore_errors=True)
