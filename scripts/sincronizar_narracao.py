#!/usr/bin/env python3
"""
Descobre onde cada linha do roteiro começa e termina dentro da narração.

O PROBLEMA: a pessoa lê as linhas com pausas, mas também respira no meio das
frases. Um corte por "silêncio maior que X" não distingue as duas coisas — numa
gravação real as pausas entre linhas foram de 0,5s no começo e de 2,6s no fim,
então nenhum limiar único acerta.

A SOLUÇÃO: o texto de cada linha é conhecido, e o número de sílabas prevê bem
quanto tempo ela leva. Então, entre todos os silêncios candidatos, escolhe-se o
conjunto de cortes cujas durações resultantes melhor batem com a proporção
esperada. É busca com programação dinâmica, não limiar.

    python3 scripts/sincronizar_narracao.py narracao.ogg --roteiro linhas.txt

Imprime a duração de cada linha, pronta para alimentar a montagem.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

# Vogais contíguas contam como um núcleo silábico. É aproximação grosseira, mas
# o que importa aqui é a PROPORÇÃO entre linhas, e para isso ela serve bem
# melhor que contar palavras ("de" e "neurodivergentes" são uma palavra cada).
_NUCLEO = re.compile(r"[aeiouáàâãéêíóôõúü]+", re.IGNORECASE)


def silabas(texto: str) -> int:
    return max(1, len(_NUCLEO.findall(texto)))


@dataclass
class Silencio:
    inicio: float
    fim: float

    @property
    def meio(self) -> float:
        return (self.inicio + self.fim) / 2

    @property
    def duracao(self) -> float:
        return self.fim - self.inicio


def duracao_total(arquivo: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(arquivo)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip())


def silencios(arquivo: Path, ruido: str = "-32dB", minimo: float = 0.30) -> list[Silencio]:
    saida = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(arquivo),
         "-af", f"silencedetect=noise={ruido}:d={minimo}", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    inicios = [float(m) for m in re.findall(r"silence_start: ([\d.]+)", saida)]
    fins = [float(m) for m in re.findall(r"silence_end: ([\d.]+)", saida)]
    return [Silencio(i, f) for i, f in zip(inicios, fins)]


def alinhar(linhas: list[str], candidatos: list[float], fim: float,
            inicio: float = 0.0) -> list[tuple[float, float]]:
    """
    Escolhe len(linhas)-1 cortes entre os candidatos, minimizando o erro
    relativo entre a duração de cada trecho e a duração que o texto previa.

    O erro é RELATIVO (proporcional à duração esperada) de propósito: um
    segundo a mais numa linha de dois segundos é um desastre; numa de dez, é
    respiração.
    """
    n, k = len(candidatos), len(linhas)
    if k == 1:
        return [(inicio, fim)]
    if n < k - 1:
        sys.exit(f"só {n} pausas detectadas para {k} linhas — grave com pausas "
                 f"mais marcadas, ou baixe o limiar")

    total_sil = sum(silabas(l) for l in linhas)
    esperado = [duracao_relativa * (fim - inicio) / total_sil
                for duracao_relativa in (silabas(l) for l in linhas)]

    pontos = [inicio] + candidatos + [fim]
    # custo[i][j] = melhor erro acumulado usando j linhas até o ponto i
    INF = float("inf")
    custo = [[INF] * (k + 1) for _ in range(len(pontos))]
    vindo = [[-1] * (k + 1) for _ in range(len(pontos))]
    custo[0][0] = 0.0
    for i in range(len(pontos)):
        for j in range(k + 1):
            if custo[i][j] == INF:
                continue
            if j == k:
                continue
            for p in range(i + 1, len(pontos)):
                # a última linha tem que terminar no fim do áudio
                if j == k - 1 and p != len(pontos) - 1:
                    continue
                dur = pontos[p] - pontos[i]
                if dur <= 0.2:
                    continue
                erro = ((dur - esperado[j]) / esperado[j]) ** 2
                if custo[i][j] + erro < custo[p][j + 1]:
                    custo[p][j + 1] = custo[i][j] + erro
                    vindo[p][j + 1] = i

    i, j = len(pontos) - 1, k
    if custo[i][j] == INF:
        sys.exit("não consegui repartir o áudio nas linhas do roteiro")
    cortes = []
    while j > 0:
        anterior = vindo[i][j]
        cortes.append((pontos[anterior], pontos[i]))
        i, j = anterior, j - 1
    return list(reversed(cortes))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", type=Path)
    ap.add_argument("--roteiro", type=Path, required=True,
                    help="arquivo de texto, uma linha do roteiro por linha")
    ap.add_argument("--ruido", default="-32dB")
    ap.add_argument("--pausa-min", type=float, default=0.30)
    args = ap.parse_args()

    linhas = [l.strip() for l in args.roteiro.read_text().splitlines() if l.strip()]
    fim = duracao_total(args.audio)
    sils = silencios(args.audio, args.ruido, args.pausa_min)
    # Silêncio colado no começo ou no fim é cabeça e rabo da gravação, não corte.
    candidatos = [s.meio for s in sils if 0.4 < s.meio < fim - 0.4]

    print(f"{fim:.1f}s de áudio, {len(candidatos)} pausas, {len(linhas)} linhas\n")
    trechos = alinhar(linhas, candidatos, fim)

    total_sil = sum(silabas(l) for l in linhas)
    for i, ((ini, f), texto) in enumerate(zip(trechos, linhas), start=1):
        dur = f - ini
        prev = silabas(texto) * fim / total_sil
        desvio = (dur - prev) / prev * 100
        marca = "  " if abs(desvio) < 35 else " <-"
        print(f"{i:2d}. {ini:6.2f} → {f:6.2f}  ({dur:5.2f}s, {desvio:+5.0f}%){marca} {texto[:46]}")

    print("\nDURACOES = [" + ", ".join(f"{f - i:.2f}" for i, f in trechos) + "]")
    print("Linhas marcadas com <- destoam do texto: confira se o corte caiu certo.")


if __name__ == "__main__":
    main()
