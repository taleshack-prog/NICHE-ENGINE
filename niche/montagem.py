#!/usr/bin/env python3
"""
Renderiza QUALQUER pauta — um caminho só, em vez de um script por episódio.

É o código que estava duplicado entre `montar_neuroart.py` e
`montar_pilares.py`: a repartição da duração entre as legendas, o cano de
quadros crus para o ffmpeg, a mistura de voz e trilha. Aqui ele recebe a pauta
como dado.

Os quadros vão CRUS pelo cano, não como PNG no disco. Medido: desenhar um
quadro custa de 1 a 80 ms, gravá-lo como PNG custa 760 ms — o render do
episódio 1 passava de quinze minutos por causa do disco, não do desenho.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .pauta import Pauta
from .proveniencia import carregar
from .visuais import Contexto, Desenho, resolver, limpar

mn = carregar("montar_neuroart")

# Plano SEM legenda tem duração própria, não proporcional.
#
# A conta é por sílaba, e texto vazio tem uma — então a ilustração que entra só
# para respirar saía com 0,2s, um piscar. Imagem sem texto precisa de tempo
# para ser vista, e esse tempo não vem do texto que ela não tem.
SEM_LEGENDA = 1.8
MINIMO_POR_PLANO = 0.8


@dataclass
class Plano:
    duracao: float
    desenhar: Desenho
    legenda: str


def contexto(p: Pauta, obras_dir: Path | None, ilustra_dir: Path | None) -> Contexto:
    """Resolve os arquivos que a pauta nomeia."""
    obras = {}
    for chave, ref in p.obras.items():
        if obras_dir is None:
            sys.exit(f"a pauta usa a obra “{chave}” — passe --obras PASTA")
        achado = next((q for q in sorted(obras_dir.iterdir())
                       if q.stem.lower().startswith(ref.arquivo.lower())), None)
        if achado is None:
            sys.exit(f"não achei {ref.arquivo}.* em {obras_dir}")
        obras[chave] = mn.Obra(ref.titulo, achado, ref.etiqueta,
                               ref.fracoes, ref.valor)
    return Contexto(obras, ilustra_dir, p.grafico or None)


def durar_blocos(p: Pauta, tempos: list[float] | None, com_voz: bool) -> list[float]:
    """
    Quanto dura cada bloco.

    Com gravação, a medida vem dela (ver niche sincronizar). Sem gravação, a
    estimativa é por sílaba — e o ritmo de LEITURA é mais lento que o de fala,
    porque ler legenda na tela custa mais que escutar.
    """
    if tempos:
        if len(tempos) != len(p.blocos):
            sys.exit(f"{len(tempos)} tempos para {len(p.blocos)} blocos")
        return tempos
    ritmo = p.ritmo_fala if com_voz else p.ritmo_leitura
    return [
        max(1.2, sum(mn.silabas(l) for l in b.legendas) / ritmo)
        + SEM_LEGENDA * sum(1 for l in b.legendas if not l.strip())
        for b in p.blocos
    ]


def cronometrar(p: Pauta, medidas: list[float]) -> list[tuple[int, float, str, str]]:
    """
    (bloco, duração, visual, legenda) de cada plano — SEM tocar em arquivo.

    Separado de `planejar` porque o dashboard precisa da régua de tempo para
    desenhar a linha do episódio, e abrir as três obras em alta resolução para
    isso seria absurdo: a duração sai do texto, não da imagem.
    """
    linha = []
    for i, (medida, bloco) in enumerate(zip(medidas, p.blocos), start=1):
        legendas = bloco.legendas
        fixos = [0.0 if l.strip() else SEM_LEGENDA for l in legendas]
        restante = medida - sum(fixos)
        total = sum(mn.silabas(l) for l in legendas if l.strip()) or 1
        for legenda, spec, fixo in zip(legendas, bloco.visuais, fixos):
            dur = fixo or restante * mn.silabas(legenda) / total
            linha.append((i, max(dur, MINIMO_POR_PLANO), spec, legenda))
    return linha


def planejar(p: Pauta, ctx: Contexto, medidas: list[float]) -> list[Plano]:
    return [Plano(dur, resolver(spec, ctx), legenda)
            for _, dur, spec, legenda in cronometrar(p, medidas)]


def renderizar(planos: list[Plano], destino: Path, silencioso: bool = False) -> float:
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo",
         "-pix_fmt", "rgb24", "-s", f"{mn.LARGURA}x{mn.ALTURA}",
         "-r", str(mn.FPS), "-i", "-", "-vf", "format=yuv420p",
         "-c:v", "libx264", "-preset", "medium", "-crf", "19", str(destino)],
        stdin=subprocess.PIPE,
    )
    assert ff.stdin is not None
    for i, plano in enumerate(planos, start=1):
        quadros = int(plano.duracao * mn.FPS)
        for q in range(quadros):
            t = q / max(quadros - 1, 1)
            img = plano.desenhar(t)
            # A legenda entra e sai em 0,4s: aparecer de supetão a cada corte
            # vira piscada.
            entrada = min(1.0, q / (mn.FPS * 0.4))
            saida = min(1.0, (quadros - q) / (mn.FPS * 0.4))
            mn.escrever_legenda(img, plano.legenda, min(entrada, saida), t)
            ff.stdin.write(img.tobytes())
        if not silencioso:
            print(f"  {i:2d}. {plano.duracao:4.1f}s  "
                  f"{plano.legenda[:54] or '(sem legenda)'}")
    ff.stdin.close()
    if ff.wait() != 0:
        sys.exit("ffmpeg falhou ao codificar")
    return sum(p.duracao for p in planos)


def _so_trilha(bruto: Path, saida: Path, trilha: Path, total: float) -> None:
    """
    Sem voz não há o que abaixar: a trilha entra inteira, normalizada para o
    patamar de publicação, com fade de 1,5s na saída para a peça não terminar
    com a música cortada no meio.
    """
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(bruto),
         "-stream_loop", "-1", "-i", str(trilha),
         "-filter_complex",
         "[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,"
         "loudnorm=I=-16:TP=-1.5:LRA=11,"
         f"afade=t=out:st={max(total - 1.5, 0):.2f}:d=1.5[aout]",
         "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy",
         "-c:a", "aac", "-b:a", "192k", "-shortest",
         "-movflags", "+faststart", str(saida)],
        check=True,
    )


def montar(p: Pauta, saida: Path, obras_dir: Path | None = None,
           ilustra_dir: Path | None = None, voz: Path | None = None,
           trilha: Path | None = None, tempos: list[float] | None = None) -> float:
    ctx = contexto(p, obras_dir, ilustra_dir)
    medidas = durar_blocos(p, tempos, bool(voz and voz.exists()))
    planos = planejar(p, ctx, medidas)

    tmp = Path(tempfile.mkdtemp(prefix="niche-montagem-"))
    try:
        total = sum(pl.duracao for pl in planos)
        print(f"{len(planos)} planos, {total:.1f}s")
        bruto = tmp / "bruto.mp4"
        total = renderizar(planos, bruto)

        saida.parent.mkdir(parents=True, exist_ok=True)
        if voz and voz.exists():
            mn.mixar(bruto, saida, voz, trilha, p.volume_trilha, p.ducking, tmp)
        elif trilha and trilha.exists():
            _so_trilha(bruto, saida, trilha, total)
        else:
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(bruto),
                            "-c", "copy", "-movflags", "+faststart", str(saida)],
                           check=True)
        print(f"\npronto: {saida}  ({total:.1f}s)")
        if not voz:
            print("sem narração — grave com `niche falar` e monte de novo com --voz")
        return total
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        limpar()
