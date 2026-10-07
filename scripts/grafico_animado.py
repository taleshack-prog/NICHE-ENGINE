#!/usr/bin/env python3
"""
B-roll de dado real: desenha um gráfico de velas se formando, em 9:16.

POR QUE ISSO EXISTE: no nicho de cripto o clichê visual é moeda dourada
girando, holograma e gráfico neon flutuando — é o que todo canal de IA usa e o
que o espectador aprendeu a ignorar. O que dá autoridade é o dado de verdade em
movimento. E dado não se gera: se desenha a partir da fonte.

Vale também para a política do YouTube. Conteúdo inautêntico é definido lá como
"text-to-speech sobre slideshow de stock"; um gráfico construído a partir de
cotação real, com recorte e marcação editorial escolhidos por um humano, é o
oposto disso — e nenhum outro canal tem este mesmo plano.

    python3 scripts/grafico_animado.py velas.json saida.mp4 --destaque 2026-08-19:2026-08-21

O JSON é a resposta crua de um endpoint de candlestick: {"data": [{open, high,
low, close, timestamp}, ...]} em qualquer ordem cronológica.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import font_manager  # noqa: E402

LARGURA, ALTURA, FPS = 1080, 1920, 30
DPI = 120

# Paleta escura, de terminal — não a de dashboard corporativo. Verde e vermelho
# são os únicos acentos: num gráfico de velas a cor JÁ carrega significado, e
# acrescentar outra competiria com ele.
# Dois temas. A cor de alta e de baixa NÃO muda entre eles: num gráfico de
# velas verde e vermelho carregam significado, e trocá-los por cor de marca
# custaria leitura para ganhar enfeite. O que a marca veste é o fundo, a grade,
# o texto e a marcação de período.
TEMAS = {
    "mercado": {
        "fundo": "#0B0E13", "grade": "#1C222C", "texto": "#E6EAF2",
        "apagado": "#6B7585", "marca": "#F5B301",
    },
    # Paleta do NeuroArt: roxo profundo com acento ciano.
    "neuroart": {
        "fundo": "#0A0415", "grade": "#2A1240", "texto": "#EFEAFF",
        "apagado": "#8E7DB5", "marca": "#22E3F0",
    },
}
ALTA = "#2BD98B"
BAIXA = "#F0484F"

# Nome dos meses escrito à mão: strftime("%B") depende do locale do sistema, e
# num container em inglês devolveu "07 de october de 2026".
MESES = ("janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
         "agosto", "setembro", "outubro", "novembro", "dezembro")

FONTES = [
    Path(__file__).resolve().parent.parent / "assets/fontes/Poppins-Bold.ttf",
    Path("/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"),
]


@dataclass
class Vela:
    quando: datetime
    abre: float
    alta: float
    baixa: float
    fecha: float

    @property
    def subiu(self) -> bool:
        return self.fecha >= self.abre


def carregar(caminho: Path) -> list[Vela]:
    bruto = json.loads(caminho.read_text())
    linhas = bruto.get("data", bruto) if isinstance(bruto, dict) else bruto
    velas = [
        Vela(
            datetime.fromisoformat(str(l["timestamp"]).replace("Z", "+00:00")),
            float(l["open"]), float(l["high"]), float(l["low"]), float(l["close"]),
        )
        for l in linhas
    ]
    velas.sort(key=lambda v: v.quando)
    if not velas:
        sys.exit("nenhuma vela no arquivo")
    return velas


def preparar_fonte() -> str:
    for f in FONTES:
        if f.exists():
            font_manager.fontManager.addfont(str(f))
            return font_manager.FontProperties(fname=str(f)).get_name()
    return "DejaVu Sans"


def desenhar(
    velas: list[Vela], visiveis: int, fonte: str, titulo: str,
    destaque: tuple[datetime, datetime] | None, destino: Path,
    tema: dict[str, str],
) -> None:
    """
    Um quadro. `visiveis` é quantas velas já apareceram — é o que cria o
    movimento: o gráfico se CONSTRUINDO, não um gráfico pronto com zoom.

    Os eixos são fixos no conjunto inteiro desde o primeiro quadro. Deixar a
    escala acompanhar o que já apareceu faria tudo tremer a cada vela nova.
    """
    fig = plt.figure(figsize=(LARGURA / DPI, ALTURA / DPI), dpi=DPI, facecolor=tema["fundo"])
    # O gráfico ocupa a faixa central: no vertical, topo e rodapé são onde ficam
    # o texto da narração e a interface do aplicativo.
    # Deixa 11% à direita para os preços do eixo — com a caixa mais larga, o
    # rótulo "85000" ficava cortado na borda da tela.
    ax = fig.add_axes((0.09, 0.26, 0.80, 0.46), facecolor=tema["fundo"])

    pmin = min(v.baixa for v in velas)
    pmax = max(v.alta for v in velas)
    folga = (pmax - pmin) * 0.08
    ax.set_xlim(-1, len(velas))
    ax.set_ylim(pmin - folga, pmax + folga)

    for lado in ax.spines.values():
        lado.set_visible(False)
    ax.grid(True, axis="y", color=tema["grade"], linewidth=1)
    ax.set_axisbelow(True)
    ax.tick_params(colors=tema["apagado"], labelsize=11, length=0)
    ax.set_xticks([])
    ax.yaxis.tick_right()
    for r in ax.get_yticklabels():
        r.set_fontname(fonte)

    if destaque:
        ini = next((i for i, v in enumerate(velas) if v.quando >= destaque[0]), None)
        fim = next((i for i, v in enumerate(velas) if v.quando > destaque[1]), len(velas))
        # A marcação só aparece quando as velas dela já foram desenhadas: marcar
        # antes entregaria o final e mataria a expectativa.
        if ini is not None and visiveis > ini:
            ax.axvspan(ini - 0.5, min(fim, visiveis) - 0.5,
                       color=tema["marca"], alpha=0.07, linewidth=0)

    largura_corpo = 0.62
    for i, v in enumerate(velas[:visiveis]):
        cor = ALTA if v.subiu else BAIXA
        ax.plot([i, i], [v.baixa, v.alta], color=cor, linewidth=1.6, solid_capstyle="round")
        alto = max(abs(v.fecha - v.abre), (pmax - pmin) * 0.0015)
        ax.add_patch(plt.Rectangle((i - largura_corpo / 2, min(v.abre, v.fecha)),
                                   largura_corpo, alto, color=cor, linewidth=0))

    atual = velas[max(visiveis - 1, 0)]
    primeira = velas[0]
    variacao = (atual.fecha / primeira.abre - 1) * 100

    fig.text(0.09, 0.855, titulo, color=tema["apagado"], fontsize=19, fontname=fonte,
             va="bottom")
    fig.text(0.09, 0.775, f"US$ {atual.fecha:,.0f}".replace(",", "."), color=tema["texto"],
             fontsize=58, fontname=fonte, va="bottom")
    fig.text(0.09, 0.745, f"{variacao:+.1f}%  desde {primeira.quando:%d/%m}",
             color=ALTA if variacao >= 0 else BAIXA, fontsize=21, fontname=fonte,
             va="bottom")
    data = f"{atual.quando.day} de {MESES[atual.quando.month - 1]} de {atual.quando.year}"
    fig.text(0.09, 0.215, data, color=tema["apagado"], fontsize=18, fontname=fonte, va="top")

    fig.savefig(destino, facecolor=tema["fundo"])
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("velas", type=Path)
    ap.add_argument("saida", type=Path)
    ap.add_argument("--titulo", default="BITCOIN / DÓLAR")
    ap.add_argument("--destaque", help="AAAA-MM-DD:AAAA-MM-DD")
    ap.add_argument("--segundos", type=float, default=8.0)
    ap.add_argument("--tema", choices=sorted(TEMAS), default="mercado")
    ap.add_argument("--quadro", type=Path, help="só gera um PNG do último quadro")
    args = ap.parse_args()

    velas = carregar(args.velas)
    fonte = preparar_fonte()
    tema = TEMAS[args.tema]
    faixa = None
    if args.destaque:
        a, b = args.destaque.split(":")
        # Sem o "T00:00:00" explícito, "2026-08-19+00:00" sai SEM fuso e a
        # comparação com as velas (que têm fuso) estoura.
        faixa = (datetime.fromisoformat(f"{a}T00:00:00+00:00"),
                 datetime.fromisoformat(f"{b}T00:00:00+00:00"))

    if args.quadro:
        desenhar(velas, len(velas), fonte, args.titulo, faixa, args.quadro, tema)
        print(f"quadro: {args.quadro}")
        return

    total = int(args.segundos * FPS)
    # 80% do tempo construindo, 20% parado no resultado: cortar no instante em
    # que a última vela aparece não dá tempo de ler o número.
    construcao = int(total * 0.8)
    tmp = Path(tempfile.mkdtemp(prefix="graf-"))
    try:
        for q in range(total):
            if q < construcao:
                # Desacelera no fim (ease-out): a formação do gráfico termina
                # assentando, em vez de bater na parede.
                t = q / construcao
                suave = 1 - (1 - t) ** 2
                visiveis = max(1, math.ceil(suave * len(velas)))
            else:
                visiveis = len(velas)
            desenhar(velas, visiveis, fonte, args.titulo, faixa, tmp / f"q{q:05d}.png", tema)

        args.saida.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
             "-i", str(tmp / "q%05d.png"),
             "-vf", f"scale={LARGURA}:{ALTURA},format=yuv420p",
             "-c:v", "libx264", "-preset", "medium", "-crf", "18",
             "-movflags", "+faststart", str(args.saida)],
            check=True,
        )
        print(f"pronto: {args.saida}  ({total / FPS:.1f}s, {len(velas)} velas)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
