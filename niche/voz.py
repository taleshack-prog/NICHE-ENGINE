#!/usr/bin/env python3
"""
Narração sintetizada, bloco a bloco, com os tempos medidos.

POR QUE BLOCO A BLOCO, e não um áudio só: a legenda precisa casar com a fala.
Hoje isso é um campo `tempos` digitado à mão depois de ouvir a gravação. Se a
voz é gerada aqui, cada bloco vira um arquivo, o `ffprobe` mede, e a medida
vira o `tempos` — a sincronia passa a ser consequência, não ajuste.

POR QUE EM DISCO: a chamada é paga. Remontar o episódio porque uma placa
ficou torta não pode gerar a narração de novo. O nome do arquivo carrega o
hash do texto, da voz e do modelo; mudou alguma coisa, é outro arquivo, e o
antigo continua lá para comparar.

POR QUE urllib E NÃO requests: o serviço roda num contêiner enxuto e esta é
a única chamada HTTP de saída do pacote. Uma dependência a menos para subir.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from . import lugares
from .pauta import Pauta

# ElevenLabs v4 pela fal. Escolhido em 15/10/2026 ouvindo três vozes na mesma
# fala do episódio 1; `language_code` nativo para pt e US$ 0,08 por mil
# caracteres — uns 7 centavos de dólar por episódio de 60 segundos.
MODELO = os.environ.get("NICHE_TTS_MODELO", "elevenlabs/tts/eleven-v4")
VOZ_PADRAO = os.environ.get("NICHE_TTS_VOZ", "Brian")
ESTABILIDADE = float(os.environ.get("NICHE_TTS_ESTABILIDADE", "0.55"))

# Respiro entre blocos e entrada antes da primeira palavra. O respiro é o que
# dá à última legenda do bloco tempo de ser lida; a entrada evita que a
# primeira sílaba comece junto com o primeiro quadro.
RESPIRO = float(os.environ.get("NICHE_TTS_RESPIRO", "0.45"))
ENTRADA = float(os.environ.get("NICHE_TTS_ENTRADA", "0.30"))
SAIDA = float(os.environ.get("NICHE_TTS_SAIDA", "0.80"))

# Taxa do áudio final. 44,1 kHz estéreo é o que a mixagem já espera.
TAXA = 44100

_ESPERA = 240  # segundos; um bloco de 20s leva ~3s, mas a fila do fal varia


class VozIndisponivel(Exception):
    """Sem credencial, ou o serviço de voz recusou."""


def disponivel() -> bool:
    return bool(_chave())


def _chave() -> str:
    # FAL_KEY é o nome que a própria fal usa; aceito FAL_API_KEY porque é o
    # erro de digitação mais provável de quem configura às pressas.
    for nome in ("FAL_KEY", "FAL_API_KEY"):
        valor = (os.environ.get(nome) or "").strip()
        if valor:
            return valor
    return ""


@dataclass
class Narracao:
    arquivo: Path
    tempos: list[float]
    caracteres: int
    gerados: int  # blocos que custaram chamada; o resto veio do disco

    @property
    def usd(self) -> float:
        """Estimativa pelo preço de tabela do modelo, por mil caracteres."""
        preco = float(os.environ.get("NICHE_TTS_PRECO_USD", "0.08"))
        return self.caracteres / 1000 * preco


def _ffprobe(arquivo: Path) -> float:
    saida = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(arquivo)],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return float(saida)


def _sintetizar(texto: str, voz: str) -> bytes:
    """Uma chamada ao modelo. Devolve o mp3 cru."""
    corpo = json.dumps({
        "text": texto,
        "voice": voz,
        "language_code": "pt",
        "stability": ESTABILIDADE,
        "output_format": "mp3_44100_128",
    }).encode("utf-8")

    pedido = urllib.request.Request(
        f"https://fal.run/{MODELO}",
        data=corpo,
        headers={
            "Authorization": f"Key {_chave()}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(pedido, timeout=_ESPERA) as r:
            resposta = json.loads(r.read())
    except urllib.error.HTTPError as e:
        detalhe = e.read().decode("utf-8", "replace")[:300]
        if e.code in (401, 403):
            raise VozIndisponivel(
                f"a fal recusou a credencial ({e.code}). Confira a FAL_KEY."
            ) from e
        raise VozIndisponivel(f"a fal respondeu {e.code}: {detalhe}") from e
    except urllib.error.URLError as e:
        raise VozIndisponivel(f"não consegui falar com a fal: {e.reason}") from e

    url = (resposta.get("audio") or {}).get("url")
    if not url:
        raise VozIndisponivel(f"resposta sem áudio: {json.dumps(resposta)[:300]}")
    with urllib.request.urlopen(url, timeout=_ESPERA) as r:
        return r.read()


def _wav(origem: Path, destino: Path) -> None:
    """Normaliza para o formato que o concat exige: todos iguais."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(origem),
         "-ar", str(TAXA), "-ac", "2", "-c:a", "pcm_s16le", str(destino)],
        check=True,
    )


def _silencio(segundos: float, destino: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", f"anullsrc=r={TAXA}:cl=stereo", "-t", f"{segundos:.3f}",
         "-c:a", "pcm_s16le", str(destino)],
        check=True,
    )


def narrar(p: Pauta, slug: str, voz: str = "", pasta: Path | None = None) -> Narracao:
    """
    Gera (ou reaproveita) a narração da pauta inteira.

    Devolve o wav montado e os tempos por bloco. A soma dos tempos é
    exatamente a duração do arquivo: o vídeo termina quando a voz termina.
    """
    if not disponivel():
        raise VozIndisponivel(
            "FAL_KEY não está no ambiente. Sem ela não há como gerar a voz."
        )

    voz = voz or VOZ_PADRAO
    pasta = pasta or lugares.VOZES
    pasta.mkdir(parents=True, exist_ok=True)
    cache = pasta / "blocos"
    cache.mkdir(parents=True, exist_ok=True)

    pedacos: list[Path] = []
    duracoes: list[float] = []
    caracteres = 0
    gerados = 0

    for i, bloco in enumerate(p.blocos, start=1):
        texto = bloco.locucao
        if not texto:
            # Bloco só de silêncio: não há o que narrar, mas o tempo existe.
            duracoes.append(0.0)
            pedacos.append(Path())
            continue

        marca = hashlib.sha256(
            f"{MODELO}|{voz}|{ESTABILIDADE}|{texto}".encode("utf-8")
        ).hexdigest()[:16]
        mp3 = cache / f"{slug}-{i:02d}-{marca}.mp3"
        if not mp3.exists():
            print(f"  voz {i}/{len(p.blocos)}: {len(texto)} caracteres")
            mp3.write_bytes(_sintetizar(texto, voz))
            gerados += 1
            caracteres += len(texto)
        else:
            print(f"  voz {i}/{len(p.blocos)}: já estava gerada")
        duracoes.append(_ffprobe(mp3))
        pedacos.append(mp3)

    # Monta a trilha de voz: entrada, blocos separados por respiro, saída.
    trabalho = pasta / f".montagem-{slug}"
    trabalho.mkdir(parents=True, exist_ok=True)
    partes: list[Path] = []
    tempos: list[float] = []

    entrada = trabalho / "entrada.wav"
    _silencio(ENTRADA, entrada)
    partes.append(entrada)

    respiro = trabalho / "respiro.wav"
    _silencio(RESPIRO, respiro)
    fim = trabalho / "saida.wav"
    _silencio(SAIDA, fim)

    for i, (mp3, duracao) in enumerate(zip(pedacos, duracoes)):
        ultimo = i == len(pedacos) - 1
        if duracao:
            convertido = trabalho / f"bloco-{i + 1:02d}.wav"
            _wav(mp3, convertido)
            partes.append(convertido)
        # O respiro pertence ao bloco que o antecede: é o tempo em que a
        # última legenda dele ainda está na tela.
        partes.append(fim if ultimo else respiro)
        tempo = duracao + (SAIDA if ultimo else RESPIRO)
        tempos.append(tempo + (ENTRADA if i == 0 else 0.0))

    lista = trabalho / "lista.txt"
    lista.write_text(
        "".join(f"file '{parte.resolve()}'\n" for parte in partes),
        encoding="utf-8",
    )
    saida = pasta / f"{slug}.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", str(lista), "-c:a", "pcm_s16le", str(saida)],
        check=True,
    )

    # Confere o que foi prometido: a soma dos tempos TEM que ser a duração do
    # arquivo, ou a legenda desliza em relação à voz ao longo do episódio.
    medido = _ffprobe(saida)
    soma = sum(tempos)
    if abs(medido - soma) > 0.25:
        raise VozIndisponivel(
            f"a narração ficou com {medido:.2f}s mas os tempos somam "
            f"{soma:.2f}s — não monto com legenda fora de sincronia."
        )

    return Narracao(saida, tempos, caracteres, gerados)
