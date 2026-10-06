#!/usr/bin/env python3
"""
Monta a peça do dogue alemão: baixa os clipes e a narração do fal, emenda,
queima a legenda e grava o mp4 final.

Roda na sua máquina porque o container do Claude não alcança o fal.media.
Precisa de ffmpeg (já instalado) e python3 (já instalado no Ubuntu).

    python3 montar-dogue.py

Saída: ~/Downloads/dogue-alemao.mp4
"""

import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

LARGURA, ALTURA, FPS = 1080, 1920, 30
PAUSA_MS = 420

# Um clipe por cena, na ordem do roteiro.
CLIPES = [
    "https://v3b.fal.media/files/b/0aad3aa7/qSbkHi3UPZnQvsiGk0t4e_output.mp4",
    "https://v3b.fal.media/files/b/0aad3a75/WhHdMf1YfNUNz62A6hI9z_output.mp4",
    "https://v3b.fal.media/files/b/0aad3a75/-6EcqRG2w-qNE0_Hfy0vb_output.mp4",
    "https://v3b.fal.media/files/b/0aad3a6b/kzBkKvMVzWPd7_jiaGUh1_output.mp4",
]

# Cada bloco: áudio da narração + as linhas de legenda que ele cobre.
# As linhas são repartidas dentro do bloco na proporção do número de letras —
# é aproximação, mas o erro fica dentro do próprio bloco e não acumula.
NARRACAO = [
    (
        "https://v3b.fal.media/files/b/0aad3a7a/eynjXcrPeF3H-M_6jM1fg_kp6PKjuE.wav",
        ["Esse cachorro vai pesar", "mais que você"],
    ),
    (
        "https://v3b.fal.media/files/b/0aad3a7b/q4zuZogAwVNbj_cFdqeyo_DTZC23II.wav",
        ["E vai continuar achando", "que cabe no seu colo"],
    ),
    (
        "https://v3b.fal.media/files/b/0aad3a61/5E9SjtFUuPhuXLCxB-d7g_jAqR4p0x.wav",
        ["O dogue alemão vive", "de sete a dez anos", "Um labrador chega aos doze"],
    ),
    (
        "https://v3b.fal.media/files/b/0aad3a61/DTgD43MkVNtKtWUbXBIUh_8aE36WEq.wav",
        ["Quem escolhe um gigante", "sabe o preço", "amor grande, tempo curto"],
    ),
    (
        "https://v3b.fal.media/files/b/0aad3a62/qUGkdULNuFNbhh0h5HmbI_CTvXuT5g.wav",
        ["Salva, se você ama um deles"],
    ),
]

FONTES = [
    Path.home() / "Downloads/NICHE-ENGINE/assets/fontes",
    Path("/usr/share/fonts/truetype/dejavu"),
]
FONTE_NOME = "Poppins"


def rodar(args: list[str]) -> None:
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print("\n".join(args), file=sys.stderr)
        print(r.stderr[-3000:], file=sys.stderr)
        sys.exit(f"ffmpeg falhou em: {args[0]}")


def duracao_ms(arquivo: Path) -> int:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(arquivo)],
        capture_output=True, text=True, check=True,
    )
    return round(float(r.stdout.strip()) * 1000)


def obter(origem: str, destino: Path) -> None:
    if origem.startswith("http"):
        with urllib.request.urlopen(origem, timeout=120) as resp, open(destino, "wb") as f:
            shutil.copyfileobj(resp, f)
    else:
        shutil.copyfile(origem, destino)


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


def main() -> None:
    saida = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "Downloads/dogue-alemao.mp4")
    tmp = Path(tempfile.mkdtemp(prefix="dogue-"))
    try:
        # ── 1. Narração: normaliza cada bloco, mede, e emenda com silêncio ──
        print("baixando narração…")
        partes, cues, cursor = [], [], 0
        for i, (url, linhas) in enumerate(NARRACAO):
            bruto = tmp / f"voz-{i}.src"
            obter(url, bruto)
            wav = tmp / f"voz-{i}.wav"
            rodar(["ffmpeg", "-y", "-loglevel", "error", "-i", str(bruto),
                   "-ar", "44100", "-ac", "1", str(wav)])
            dur = duracao_ms(wav)
            partes.append(wav)

            # Reparte o bloco entre suas linhas, proporcional ao tamanho delas.
            total_chars = sum(len(l) for l in linhas) or 1
            pos = cursor
            for linha in linhas:
                fatia = round(dur * len(linha) / total_chars)
                cues.append((pos, pos + fatia, linha))
                pos += fatia
            cursor += dur

            if i < len(NARRACAO) - 1:
                sil = tmp / f"pausa-{i}.wav"
                rodar(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
                       "-i", "anullsrc=channel_layout=mono:sample_rate=44100",
                       "-t", f"{PAUSA_MS / 1000:.3f}", str(sil)])
                partes.append(sil)
                cursor += PAUSA_MS

        lista_voz = tmp / "voz.txt"
        lista_voz.write_text("\n".join(f"file '{p}'" for p in partes))
        voz = tmp / "narracao.m4a"
        rodar(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
               "-i", str(lista_voz), "-c:a", "aac", "-b:a", "160k", str(voz)])
        print(f"narração: {duracao_ms(voz) / 1000:.1f}s")

        # ── 2. Clipes: normaliza tudo para o mesmo formato antes de emendar ──
        print("baixando clipes…")
        normalizados = []
        for i, url in enumerate(CLIPES):
            bruto = tmp / f"clipe-{i}.src.mp4"
            obter(url, bruto)
            norm = tmp / f"clipe-{i}.mp4"
            rodar(["ffmpeg", "-y", "-loglevel", "error", "-i", str(bruto),
                   "-vf", f"scale={LARGURA}:{ALTURA}:force_original_aspect_ratio=increase,"
                          f"crop={LARGURA}:{ALTURA},fps={FPS},format=yuv420p",
                   "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", str(norm)])
            normalizados.append(norm)

        lista_v = tmp / "clipes.txt"
        lista_v.write_text("\n".join(f"file '{p}'" for p in normalizados))
        bruto_v = tmp / "bruto.mp4"
        rodar(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
               "-i", str(lista_v), "-c", "copy", str(bruto_v)])
        print(f"vídeo bruto: {duracao_ms(bruto_v) / 1000:.1f}s")

        # ── 3. Legenda + áudio numa passada ──
        ass = tmp / "legenda.ass"
        ass.write_text(construir_ass(cues))
        dir_fontes = next((str(d) for d in FONTES if d.exists()), None)
        filtro = f"ass={ass}"
        if dir_fontes:
            filtro += f":fontsdir={dir_fontes}"
        else:
            print("aviso: pasta de fontes não encontrada, usando a fonte padrão do sistema")

        saida.parent.mkdir(parents=True, exist_ok=True)
        rodar(["ffmpeg", "-y", "-loglevel", "error", "-i", str(bruto_v), "-i", str(voz),
               "-vf", filtro, "-map", "0:v:0", "-map", "1:a:0",
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
               str(saida)])

        print(f"\npronto: {saida}  ({duracao_ms(saida) / 1000:.1f}s)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
