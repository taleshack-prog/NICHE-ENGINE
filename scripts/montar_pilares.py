#!/usr/bin/env python3
"""
Episódio 2 — os pilares científicos, em 9:16.

Reaproveita os planos do episódio 1 (obras, placas, legenda, mistura) e
acrescenta o forest plot da meta-análise como plano central.

A ORDEM DOS PILARES MUDOU em relação à pauta original. Na legenda escrita pelo
usuário o jiu-jitsu era o terceiro de quatro; a pesquisa mostrou que é o único
com meta-análise por trás — artes marciais foi a ÚNICA modalidade de exercício
com efeito significativo sobre controle inibitório em crianças autistas. Numa
peça de 50 segundos, o argumento mais forte vai primeiro.

    python3 scripts/montar_pilares.py --obras PASTA --saida pilares.mp4 \\
        [--voz narracao.ogg --trilha trilha.mp3 --tempos t1,...,t7]
"""

from __future__ import annotations

import argparse
import importlib.util
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent

def _carregar(nome: str):
    spec = importlib.util.spec_from_file_location(nome, RAIZ / f"{nome}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nome] = mod
    spec.loader.exec_module(mod)
    return mod

mn = _carregar("montar_neuroart")
ge = _carregar("grafico_efeitos")

LARGURA, ALTURA, FPS = mn.LARGURA, mn.ALTURA, mn.FPS


def plano_floresta(t: float, fonte: str) -> "mn.Image.Image":
    """O forest plot, com as linhas surgindo de cima para baixo."""
    destino = _TMP / f"fl-{int(t * 1000):05d}.png"
    ge.desenhar(t, fonte, destino)
    img = mn.Image.open(destino).convert("RGB")
    destino.unlink(missing_ok=True)
    return img


_TMP = Path(tempfile.mkdtemp(prefix="pilares-quadros-"))


def montar(obras: dict, saida: Path, voz: Path | None, trilha: Path | None,
           tempos: list[float] | None, volume: float, ducking: float) -> None:
    kanji, abissal, metropole = obras["kanji"], obras["abissal"], obras["metropole"]
    fonte_ge = ge.preparar_fonte()
    P = mn.plano_placa

    blocos: list[list[tuple[str, object]]] = [
        [("Testaram vários tipos de exercício em crianças autistas",
          lambda t: P("META-ANÁLISE", "18 estudos",
                      "exercício e controle inibitório no autismo", t)),
         ("medindo controle inibitório",
          lambda t: P("PARTICIPANTES", "499 crianças",
                      "8 ensaios randomizados na meta-análise", t)),
         ("Dezoito estudos, quase quinhentas crianças",
          lambda t: plano_floresta(t * 0.25, fonte_ge))],

        [("Esporte de bola não deu resultado",
          lambda t: plano_floresta(0.25 + t * 0.35, fonte_ge)),
         ("Modalidade combinada também não",
          lambda t: plano_floresta(0.60 + t * 0.25, fonte_ge)),
         ("Só uma coisa funcionou: arte marcial",
          lambda t: plano_floresta(0.85 + t * 0.15, fonte_ge))],

        [("E num ensaio randomizado com crianças com TDAH",
          lambda t: P("ENSAIO CONTROLADO", "57 crianças",
                      "TDAH, 8 a 12 anos, com grupo controle", t)),
         ("doze semanas de judô melhoraram a memória de trabalho",
          lambda t: P("INTERVENÇÃO", "12 semanas",
                      "duas sessões de judô por semana", t)),
         ("O eletroencefalograma confirmou",
          lambda t: P("MEDIDA NEURAL", "EEG, 64 eletrodos",
                      "atividade de retardo contralateral", t)),
         ("a mudança apareceu no cérebro, não só no teste",
          lambda t: mn.plano_detalhe(abissal, t, 0.4, 0.64))],

        [("Por isso o jiu-jitsu é um dos pilares do NeuroArt",
          lambda t: P("PILAR", "Artes marciais",
                      "controle inibitório e regulação sensorial", t)),
         ("Não é tema de marketing",
          lambda t: mn.plano_detalhe(kanji, t, 0.25, 0.62)),
         ("é o pilar com a evidência mais forte que a gente tem",
          lambda t: plano_floresta(1.0, fonte_ge))],

        # O pilar da criação visual tem indício, não prova — e é justamente
        # por isso que existe o fundo de pesquisa. Enquadrar o indício como
        # MOTIVO do fundo, e não como fraqueza a esconder, liga este episódio
        # ao anterior e é a posição honesta.
        [("Os outros três são a criação visual",
          lambda t: P("PILAR", "Criação visual",
                      "há indícios na literatura; aprofundá-los é o objetivo "
                      "do fundo de pesquisa", t)),
         ("há indícios na literatura, e aprofundá-los é o que o fundo financia",
          lambda t: mn.plano_obra(metropole, t * 0.5, 0.5)),
         ("o ambiente, desenhado para reduzir sobrecarga sensorial",
          lambda t: P("PILAR", "Ambiente",
                      "espaços desenhados para reduzir sobrecarga sensorial", t)),
         ("e a interface cérebro-computador",
          lambda t: P("PILAR", "Interface cérebro-computador",
                      "registro de estados de foco com dados anonimizados", t)),
         # A honestidade é o plano: o roxo apagado em vez do ciano marca
         # visualmente que este pilar ainda não existe.
         ("que ainda não existe. É o próximo passo",
          lambda t: P("ROADMAP", "Ainda não existe",
                      "a interface cérebro-computador é o próximo passo, "
                      "não uma entrega", t, mn.APAGADO))],

        [("A arte é o que o projeto tokeniza",
          lambda t: mn.plano_etiquetas([kanji, abissal, metropole], t)),
         ("A ciência é o que ele investiga",
          lambda t: plano_floresta(1.0, fonte_ge))],

        [("NeuroArt DApp — unindo a arte à ciência", mn.plano_fecho)],
    ]

    if tempos:
        if len(tempos) != len(blocos):
            sys.exit(f"{len(tempos)} tempos para {len(blocos)} blocos")
        medidas = tempos
    else:
        medidas = [sum(mn.silabas(l) for l, _ in b) / 5.4 for b in blocos]

    roteiro = []
    for medida, bloco in zip(medidas, blocos):
        total = sum(mn.silabas(l) for l, _ in bloco)
        for legenda, visual in bloco:
            roteiro.append((medida * mn.silabas(legenda) / total, visual, legenda))

    tmp = Path(tempfile.mkdtemp(prefix="pilares-"))
    try:
        total_s = sum(d for d, _, _ in roteiro)
        print(f"{len(roteiro)} planos, {total_s:.1f}s")
        bruto = tmp / "bruto.mp4"
        ff = subprocess.Popen(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo",
             "-pix_fmt", "rgb24", "-s", f"{LARGURA}x{ALTURA}", "-r", str(FPS),
             "-i", "-", "-vf", "format=yuv420p", "-c:v", "libx264",
             "-preset", "medium", "-crf", "19", str(bruto)],
            stdin=subprocess.PIPE,
        )
        assert ff.stdin is not None
        for i, (dur, desenhar, legenda) in enumerate(roteiro, start=1):
            quadros = int(dur * FPS)
            for q in range(quadros):
                t = q / max(quadros - 1, 1)
                img = desenhar(t)
                entrada = min(1.0, q / (FPS * 0.4))
                saida_f = min(1.0, (quadros - q) / (FPS * 0.4))
                mn.escrever_legenda(img, legenda, min(entrada, saida_f))
                ff.stdin.write(img.tobytes())
            print(f"  {i:2d}. {dur:4.1f}s  {legenda[:54]}")
        ff.stdin.close()
        if ff.wait() != 0:
            sys.exit("ffmpeg falhou ao codificar")

        saida.parent.mkdir(parents=True, exist_ok=True)
        if voz and voz.exists():
            mn.mixar(bruto, saida, voz, trilha, volume, ducking, tmp)
        else:
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(bruto),
                            "-c", "copy", "-movflags", "+faststart", str(saida)],
                           check=True)
        print(f"\npronto: {saida}  ({total_s:.1f}s)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.rmtree(_TMP, ignore_errors=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--obras", type=Path, required=True)
    ap.add_argument("--saida", type=Path, default=Path.home() / "Downloads/pilares.mp4")
    ap.add_argument("--voz", type=Path)
    ap.add_argument("--trilha", type=Path)
    ap.add_argument("--tempos")
    ap.add_argument("--volume-trilha", type=float, default=0.75)
    ap.add_argument("--ducking", type=float, default=3.5)
    args = ap.parse_args()

    obras = {}
    for chave, base in (("kanji", "white-kanji"), ("abissal", "frequencia-abissal"),
                        ("metropole", "metropole-suspensa")):
        achado = next((p for p in args.obras.iterdir()
                       if p.stem.lower().startswith(base)), None)
        if achado is None:
            sys.exit(f"não achei {base}.* em {args.obras}")
        obras[chave] = mn.Obra(mn.TITULOS[chave], achado, "", 0, 0)

    tempos = [float(x) for x in args.tempos.split(",")] if args.tempos else None
    montar(obras, args.saida, args.voz, args.trilha, tempos,
           args.volume_trilha, args.ducking)


if __name__ == "__main__":
    main()
