#!/usr/bin/env python3
"""
Monta a peça com FILMAGEM REAL do Pexels em vez de imagem gerada.

POR QUE EXISTE: a versão gerada não emocionava, e não era defeito de prompt.
Empatia em conteúdo de pet vem da relação entre o animal e uma pessoa — mão na
cabeça, cão subindo no colo, cabeça apoiada no joelho. O RESTRICOES_VISUAIS do
motor proíbe pessoas e rostos, porque é onde a IA generativa falha de forma mais
visível. Banco de filmagem real resolve os dois: tem gente, e a anatomia está
certa porque o cachorro é de verdade.

A UNIDADE DE CORTE É A LINHA DE LEGENDA. Antes eram 4 planos de 5s em 20s —
apresentação de slides. Aqui cada linha da narração vira um plano, o que dá 11
planos de ~1,8s, e cada corte cai exatamente onde a frase troca. É de onde vem
o ritmo, sem precisar detectar batida.

    export PEXELS_API_KEY=...          # grátis e instantâneo em pexels.com/api
    python3 scripts/montar-real.py

    # não gostou do plano 3? troca pelo segundo candidato daquela busca:
    python3 scripts/montar-real.py --trocar 3=1
    # vários de uma vez, e os downloads ficam em cache — não baixa de novo:
    python3 scripts/montar-real.py --trocar 3=1 --trocar 7=2 --trocar 9=4

Trilha (opcional): coloque um mp3/m4a em ~/Downloads/trilha.mp3 e ele entra
abaixo da voz, com ducking. Sem arquivo, o vídeo sai só com narração.

Saída: ~/Downloads/dogue-real.mp4
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

LARGURA, ALTURA, FPS = 1080, 1920, 30
PAUSA_MS = 420
CANDIDATOS = 12  # quantos resultados guardar por plano, para o --trocar ter de onde tirar
CACHE = Path.home() / ".cache/niche-engine/pexels"
TRILHA = Path.home() / "Downloads/trilha.mp3"

FONTES = [
    Path.home() / "Downloads/NICHE-ENGINE/assets/fontes",
    Path(__file__).resolve().parent.parent / "assets/fontes",
    Path("/usr/share/fonts/truetype/dejavu"),
]
FONTE_NOME = "Poppins"


@dataclass
class Plano:
    """Uma linha de legenda e a busca que traz a imagem dela."""

    linha: str
    busca: str


# Narração já gerada e paga, um áudio por bloco de pontuação.
# Cada bloco carrega seus planos; a duração de cada plano sai repartida dentro
# do bloco na proporção do número de letras da linha. O erro fica preso ao
# bloco e não acumula ao longo da peça.
#
# As buscas estão em inglês de propósito: é onde o acervo do Pexels é grande.
# E quase todas pedem UMA PESSOA no quadro — é o que estava faltando.
BLOCOS: list[tuple[str, list[Plano]]] = [
    (
        "https://v3b.fal.media/files/b/0aad3a7a/eynjXcrPeF3H-M_6jM1fg_kp6PKjuE.wav",
        [
            Plano("Esse cachorro vai pesar", "great dane standing beside woman full body"),
            Plano("mais que você", "large dog paw in human hand close up"),
        ],
    ),
    (
        "https://v3b.fal.media/files/b/0aad3a7b/q4zuZogAwVNbj_cFdqeyo_DTZC23II.wav",
        [
            Plano("E vai continuar achando", "big dog climbing onto owner lap sofa"),
            Plano("que cabe no seu colo", "huge dog lying on woman lap couch"),
        ],
    ),
    (
        "https://v3b.fal.media/files/b/0aad3a61/5E9SjtFUuPhuXLCxB-d7g_jAqR4p0x.wav",
        [
            Plano("O dogue alemão vive", "great dane close up portrait slow motion"),
            Plano("de sete a dez anos", "old dog grey muzzle close up eyes"),
            Plano("Um labrador chega aos doze", "labrador running happy grass slow motion"),
        ],
    ),
    (
        "https://v3b.fal.media/files/b/0aad3a61/DTgD43MkVNtKtWUbXBIUh_8aE36WEq.wav",
        [
            Plano("Quem escolhe um gigante", "woman hugging large dog tight"),
            Plano("sabe o preço", "person petting big dog head slowly"),
            Plano("amor grande, tempo curto", "dog resting head on owner knee"),
        ],
    ),
    (
        "https://v3b.fal.media/files/b/0aad3a62/qUGkdULNuFNbhh0h5HmbI_CTvXuT5g.wav",
        [
            Plano("Salva, se você ama um deles", "dog looking into camera close up eyes"),
        ],
    ),
]


# ─────────────────────────── utilitários ───────────────────────────


def rodar(args: list[str]) -> None:
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print(" ".join(args), file=sys.stderr)
        print(r.stderr[-3000:], file=sys.stderr)
        sys.exit(f"ffmpeg falhou ({args[0]})")


def duracao_ms(arquivo: Path) -> int:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(arquivo)],
        capture_output=True, text=True, check=True,
    )
    return round(float(r.stdout.strip()) * 1000)


def chave_pexels() -> str:
    """Env primeiro; depois o .env do repositório, se existir."""
    if k := os.environ.get("PEXELS_API_KEY"):
        return k.strip()
    for env in (Path(__file__).resolve().parent.parent / ".env",
                Path.home() / "Downloads/NICHE-ENGINE/.env"):
        if env.exists():
            for linha in env.read_text().splitlines():
                if m := re.match(r"\s*PEXELS_API_KEY\s*=\s*(.+)", linha):
                    return m.group(1).strip().strip("'\"")
    sys.exit(
        "falta a PEXELS_API_KEY.\n"
        "  1. pegue a sua (grátis, instantâneo) em https://www.pexels.com/api/\n"
        "  2. abra o .env no VSCode e acrescente a linha  PEXELS_API_KEY=...\n"
        "     (no VSCode, não pelo terminal)"
    )


def baixar(url: str, destino: Path, cabecalhos: dict[str, str] | None = None) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=cabecalhos or {})
    with urllib.request.urlopen(req, timeout=180) as resp, open(destino, "wb") as f:
        shutil.copyfileobj(resp, f)


# ─────────────────────────── Pexels ───────────────────────────


def buscar(termo: str, chave: str) -> list[dict]:
    """
    Vídeos verticais primeiro. Se o acervo não tiver retrato suficiente para
    aquele termo, aceita qualquer orientação — recortar do meio de um 16:9
    perde as laterais, mas é melhor que não ter o plano.
    """
    saida: list[dict] = []
    vistos: set[int] = set()
    for orientacao in ("portrait", None):
        params = {"query": termo, "per_page": CANDIDATOS, "size": "medium"}
        if orientacao:
            params["orientation"] = orientacao
        url = "https://api.pexels.com/v1/videos/search?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"Authorization": chave})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                dados = json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                sys.exit(f"Pexels recusou a chave (HTTP {e.code}). Confira a PEXELS_API_KEY.")
            raise
        for v in dados.get("videos", []):
            if v["id"] not in vistos:
                vistos.add(v["id"])
                saida.append(v)
        if len(saida) >= CANDIDATOS:
            break
    return saida


def melhor_arquivo(video: dict) -> dict | None:
    """
    O maior arquivo que ainda não é exagero: 4K levaria minutos para baixar e
    seria reduzido para 1080 de qualquer jeito. Prefere retrato.
    """
    arquivos = [f for f in video.get("video_files", []) if f.get("link") and f.get("height")]
    if not arquivos:
        return None
    def nota(f: dict) -> tuple[int, int]:
        retrato = 1 if f["height"] > (f.get("width") or 0) else 0
        return (retrato, -abs((f.get("height") or 0) - 1920))
    return sorted(arquivos, key=nota, reverse=True)[0]


def obter_clipe(video: dict) -> Path:
    arq = melhor_arquivo(video)
    if not arq:
        raise RuntimeError(f"vídeo {video['id']} sem arquivo utilizável")
    destino = CACHE / f"{video['id']}.mp4"
    if not destino.exists() or destino.stat().st_size == 0:
        baixar(arq["link"], destino)
    return destino


# ─────────────────────────── legenda ───────────────────────────


def tempo_ass(ms: int) -> str:
    cs = round(ms / 10)
    return f"{cs // 360000}:{cs % 360000 // 6000:02d}:{cs % 6000 // 100:02d}.{cs % 100:02d}"


def construir_ass(cues: list[tuple[int, int, str]]) -> str:
    corpo = round(ALTURA * 0.040)
    margem = round(ALTURA * 0.17)
    contorno = max(2, round(corpo * 0.10))
    cab = [
        "[Script Info]", "ScriptType: v4.00+",
        f"PlayResX: {LARGURA}", f"PlayResY: {ALTURA}",
        "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,"
        " BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,"
        " BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: N,{FONTE_NOME},{corpo},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,"
        f"100,100,0,0,1,{contorno},{contorno // 2},2,{round(LARGURA * 0.09)},"
        f"{round(LARGURA * 0.09)},{margem},1",
        "", "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for ini, fim, txt in cues:
        limpo = txt.replace("{", "(").replace("}", ")").upper()
        cab.append(f"Dialogue: 0,{tempo_ass(ini)},{tempo_ass(fim)},N,,0,0,0,,{limpo}")
    return "\n".join(cab) + "\n"


# ─────────────────────────── montagem ───────────────────────────


def recortar(origem: Path, destino: Path, duracao_ms_alvo: int) -> None:
    """
    Tira do clipe uma janela do tamanho exato do plano, começando 15% adiante:
    o primeiro instante de filmagem de banco costuma ser o pior (câmera
    assentando, pessoa entrando no quadro). Clipe curto demais entra inteiro e
    é esticado pelo `tpad` do último quadro, para não deixar buraco.
    """
    dur_s = duracao_ms_alvo / 1000
    total_s = duracao_ms(origem) / 1000
    inicio = 0.0
    if total_s > dur_s:
        inicio = min(total_s * 0.15, total_s - dur_s)

    vf = (
        f"scale={LARGURA}:{ALTURA}:force_original_aspect_ratio=increase,"
        f"crop={LARGURA}:{ALTURA},fps={FPS},"
        f"tpad=stop_mode=clone:stop_duration=3,format=yuv420p"
    )
    rodar([
        "ffmpeg", "-y", "-loglevel", "error", "-accurate_seek",
        "-ss", f"{inicio:.3f}", "-i", str(origem),
        "-t", f"{dur_s:.3f}", "-vf", vf, "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-video_track_timescale", "90000", str(destino),
    ])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trocar", action="append", default=[], metavar="PLANO=INDICE",
                    help="usa outro candidato naquele plano, ex: --trocar 3=1")
    ap.add_argument("--saida", default=str(Path.home() / "Downloads/dogue-real.mp4"))
    args = ap.parse_args()

    escolhas: dict[int, int] = {}
    for t in args.trocar:
        if not re.fullmatch(r"\d+=\d+", t):
            sys.exit(f"--trocar espera PLANO=INDICE, recebi {t!r}")
        p, i = t.split("=")
        escolhas[int(p)] = int(i)

    chave = chave_pexels()
    saida = Path(args.saida)
    tmp = Path(tempfile.mkdtemp(prefix="real-"))
    try:
        # ── 1. Narração: mede cada bloco e reparte entre os planos dele ──
        print("narração…")
        audios: list[Path] = []
        planos: list[tuple[Plano, int, int]] = []  # plano, inicioMs, duracaoMs
        cursor = 0
        for i, (url, lista) in enumerate(BLOCOS):
            bruto = tmp / f"voz-{i}.src"
            baixar(url, bruto)
            wav = tmp / f"voz-{i}.wav"
            rodar(["ffmpeg", "-y", "-loglevel", "error", "-i", str(bruto),
                   "-ar", "44100", "-ac", "1", str(wav)])
            dur = duracao_ms(wav)
            audios.append(wav)

            letras = sum(len(p.linha) for p in lista) or 1
            pos, restante = cursor, dur
            for j, plano in enumerate(lista):
                fatia = restante if j == len(lista) - 1 else round(dur * len(plano.linha) / letras)
                planos.append((plano, pos, fatia))
                pos += fatia
                restante -= fatia
            cursor += dur

            if i < len(BLOCOS) - 1:
                sil = tmp / f"pausa-{i}.wav"
                rodar(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
                       "-i", "anullsrc=channel_layout=mono:sample_rate=44100",
                       "-t", f"{PAUSA_MS / 1000:.3f}", str(sil)])
                audios.append(sil)
                # A pausa entra no plano anterior: corte em cima de silêncio
                # deixa o vídeo parado por quase meio segundo.
                p, ini, d = planos[-1]
                planos[-1] = (p, ini, d + PAUSA_MS)
                cursor += PAUSA_MS

        lista_voz = tmp / "voz.txt"
        lista_voz.write_text("\n".join(f"file '{p}'" for p in audios))
        voz = tmp / "narracao.m4a"
        rodar(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
               "-i", str(lista_voz), "-c:a", "aac", "-b:a", "160k", str(voz)])
        print(f"  {duracao_ms(voz) / 1000:.1f}s em {len(planos)} planos "
              f"(média {sum(d for _, _, d in planos) / len(planos) / 1000:.1f}s por corte)")

        # ── 2. Um clipe real por plano ──
        print(f"buscando {len(planos)} clipes no Pexels…")
        pedacos, creditos, cues = [], [], []
        for n, (plano, ini, dur) in enumerate(planos, start=1):
            cues.append((ini, ini + dur, plano.linha))
            resultados = buscar(plano.busca, chave)
            if not resultados:
                sys.exit(f"plano {n}: nenhum resultado para {plano.busca!r}. "
                         f"Troque a busca nessa linha do script.")
            idx = escolhas.get(n, 0)
            if idx >= len(resultados):
                sys.exit(f"plano {n}: só há {len(resultados)} candidatos, "
                         f"índices 0 a {len(resultados) - 1}.")
            video = resultados[idx]
            origem = obter_clipe(video)
            corte = tmp / f"plano-{n:02d}.mp4"
            recortar(origem, corte, dur)
            pedacos.append(corte)
            creditos.append((n, plano.linha, video, len(resultados)))
            print(f"  {n:2d}. {dur/1000:4.1f}s  {plano.linha}")

        lista_v = tmp / "planos.txt"
        lista_v.write_text("\n".join(f"file '{p}'" for p in pedacos))
        bruto_v = tmp / "bruto.mp4"
        rodar(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
               "-i", str(lista_v), "-c", "copy", str(bruto_v)])

        # ── 3. Legenda, voz e trilha numa passada ──
        ass = tmp / "legenda.ass"
        ass.write_text(construir_ass(cues))
        dir_fontes = next((str(d) for d in FONTES if d.exists()), None)
        filtro_v = f"ass={ass}" + (f":fontsdir={dir_fontes}" if dir_fontes else "")
        if not dir_fontes:
            print("aviso: pasta de fontes não encontrada, usando a do sistema")

        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(bruto_v), "-i", str(voz)]
        if TRILHA.exists():
            # Trilha em loop, abaixo da voz e com ducking: a voz comprime a
            # música em vez de disputar com ela.
            cmd += ["-stream_loop", "-1", "-i", str(TRILHA)]
            audio = (
                "[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[voz][lado];"
                "[2:a]aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.22[mus];"
                "[mus][lado]sidechaincompress="
                "threshold=0.03:ratio=12:attack=15:release=350[duck];"
                "[voz][duck]amix=inputs=2:duration=first:normalize=0[aout]"
            )
            cmd += ["-filter_complex", f"[0:v]{filtro_v}[v];{audio}",
                    "-map", "[v]", "-map", "[aout]"]
            print(f"trilha: {TRILHA.name}")
        else:
            cmd += ["-vf", filtro_v, "-map", "0:v:0", "-map", "1:a:0"]
            print(f"sem trilha (coloque um mp3 em {TRILHA} e rode de novo)")

        saida.parent.mkdir(parents=True, exist_ok=True)
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
                str(saida)]
        rodar(cmd)

        print(f"\npronto: {saida}  ({duracao_ms(saida) / 1000:.1f}s)")
        print("\nplano a plano — para trocar, use o número:")
        for n, linha, v, total in creditos:
            print(f"  {n:2d}. {linha}\n      {v['url']}  ({total} candidatos)")
        print("\ncréditos para a legenda do post (o Pexels pede):")
        autores = sorted({v["user"]["name"] for _, _, v, _ in creditos})
        print("      Vídeos: " + ", ".join(autores) + " / Pexels")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
