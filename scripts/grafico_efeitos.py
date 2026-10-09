#!/usr/bin/env python3
"""
Gráfico de floresta (forest plot) em 9:16 — tamanho de efeito com intervalo.

POR QUE ESTE GRÁFICO E NÃO UMA BARRA: o assunto é "qual modalidade funciona",
e a resposta honesta depende do intervalo de confiança, não só do ponto. Uma
barra esconderia que esportes de bola têm efeito aparente mas cruzam o zero;
o forest plot mostra exatamente isso, e é a forma que a própria literatura usa.

Convenção mantida: efeito à ESQUERDA do zero é melhora (a medida é tempo de
erro em tarefa de controle inibitório, onde menos é melhor), e o intervalo que
cruza o zero é desenhado apagado, porque não sustenta conclusão.

    python3 scripts/grafico_efeitos.py saida.mp4 --segundos 7
"""

from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import font_manager  # noqa: E402

LARGURA, ALTURA, FPS, DPI = 1080, 1920, 30, 120

FUNDO = "#0A0415"
GRADE = "#2A1240"
TEXTO = "#EFEAFF"
APAGADO = "#8E7DB5"
CIANO = "#22E3F0"
NEUTRO = "#4A3668"

FONTES = [
    Path(__file__).resolve().parent.parent / "assets/fontes/Poppins-Bold.ttf",
    Path("/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"),
]


@dataclass
class Efeito:
    """Uma linha do gráfico: modalidade, efeito e intervalo de confiança."""

    rotulo: str
    smd: float
    baixo: float
    alto: float

    @property
    def significativo(self) -> bool:
        """Intervalo que cruza o zero não sustenta conclusão."""
        return self.alto < 0 or self.baixo > 0


# Meta-análise de exercício e controle inibitório em crianças e adolescentes
# autistas: 18 estudos, 499 participantes; 8 ECRs (n=284) na meta-análise.
# Artes marciais foi a ÚNICA modalidade com efeito significativo.
DADOS = [
    Efeito("ARTES MARCIAIS", -0.54, -0.92, -0.14),
    Efeito("ESPORTES DE BOLA", -0.38, -0.84, 0.08),
    Efeito("COMBINADOS", -0.40, -0.88, 0.09),
]
GERAL = Efeito("EFEITO GERAL", -0.49, -0.72, -0.26)


def preparar_fonte() -> str:
    for f in FONTES:
        if f.exists():
            font_manager.fontManager.addfont(str(f))
            return font_manager.FontProperties(fname=str(f)).get_name()
    return "DejaVu Sans"


def desenhar(revelados: float, fonte: str, destino: Path) -> None:
    fig = plt.figure(figsize=(LARGURA / DPI, ALTURA / DPI), dpi=DPI, facecolor=FUNDO)
    # A caixa termina em 0.86 para sobrar margem: os valores ficam FORA do
    # eixo, e com a caixa mais larga o "-0.54" era cortado pela borda da tela.
    ax = fig.add_axes((0.30, 0.34, 0.56, 0.30), facecolor=FUNDO)

    linhas = DADOS + [GERAL]
    ax.set_xlim(-1.15, 0.55)
    ax.set_ylim(-0.8, len(linhas) - 0.2)
    ax.invert_yaxis()
    for lado in ax.spines.values():
        lado.set_visible(False)
    ax.set_yticks([])
    ax.tick_params(colors=APAGADO, labelsize=13, length=0)
    ax.set_xticks([-1.0, -0.5, 0.0])
    for r in ax.get_xticklabels():
        r.set_fontname(fonte)

    # A linha do zero é a referência de "nenhum efeito".
    ax.axvline(0, color=GRADE, linewidth=2)

    for i, e in enumerate(linhas):
        if i >= revelados * len(linhas):
            continue
        cor = CIANO if e.significativo else NEUTRO
        espessura = 3.0 if e.significativo else 2.0
        ax.plot([e.baixo, e.alto], [i, i], color=cor, linewidth=espessura,
                solid_capstyle="round")
        for x in (e.baixo, e.alto):
            ax.plot([x, x], [i - 0.12, i + 0.12], color=cor, linewidth=espessura)
        ax.plot([e.smd], [i], marker="D" if e is GERAL else "o",
                markersize=13 if e is GERAL else 11, color=cor)

        ax.text(-1.22, i, e.rotulo, color=TEXTO if e.significativo else APAGADO,
                fontsize=17, fontname=fonte, va="center", ha="right")
        marca = f"{e.smd:.2f}" if e.significativo else "n.s."
        ax.text(0.42, i, marca, color=cor, fontsize=17, fontname=fonte,
                va="center", ha="left")

    fig.text(0.08, 0.80, "EXERCÍCIO E CONTROLE INIBITÓRIO", color=APAGADO,
             fontsize=20, fontname=fonte)
    fig.text(0.08, 0.735, "Só uma modalidade", color=TEXTO, fontsize=54,
             fontname=fonte)
    fig.text(0.08, 0.685, "funcionou", color=CIANO, fontsize=54, fontname=fonte)
    fig.text(0.08, 0.285, "18 estudos · 499 crianças autistas · 8 ensaios randomizados",
             color=APAGADO, fontsize=17, fontname=fonte, va="top")
    fig.text(0.08, 0.255, "diferença média padronizada, intervalo de 95%",
             color=APAGADO, fontsize=15, fontname=fonte, va="top")

    fig.savefig(destino, facecolor=FUNDO)
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("saida", type=Path)
    ap.add_argument("--segundos", type=float, default=7.0)
    ap.add_argument("--quadro", type=Path)
    args = ap.parse_args()

    fonte = preparar_fonte()
    if args.quadro:
        desenhar(1.0, fonte, args.quadro)
        print(f"quadro: {args.quadro}")
        return

    total = int(args.segundos * FPS)
    tmp = Path(tempfile.mkdtemp(prefix="efeitos-"))
    try:
        for q in range(total):
            t = min(1.0, q / (total * 0.65))
            desenhar(1 - (1 - t) ** 2, fonte, tmp / f"q{q:05d}.png")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
             "-i", str(tmp / "q%05d.png"), "-vf", "format=yuv420p",
             "-c:v", "libx264", "-preset", "medium", "-crf", "18",
             "-movflags", "+faststart", str(args.saida)],
            check=True,
        )
        print(f"pronto: {args.saida}  ({total / FPS:.1f}s)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
