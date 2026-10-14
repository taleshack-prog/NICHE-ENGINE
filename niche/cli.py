#!/usr/bin/env python3
"""
A linha de comando do Niche Engine.

    python3 -m niche validar      pautas/02-pilares.yml
    python3 -m niche falar        pautas/02-pilares.yml
    python3 -m niche sincronizar  pautas/02-pilares.yml narracao.ogg
    python3 -m niche montar       pautas/02-pilares.yml --saida ep2.mp4 \\
        --obras PASTA --ilustra PASTA --voz narracao.ogg --trilha trilha.mp3

A ORDEM É A DO TRABALHO REAL: escreve a pauta, `validar` recusa o que estiver
errado, `falar` imprime o texto corrido para gravar, `sincronizar` mede a
gravação e devolve os tempos, `montar` fecha.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import linter
from .pauta import PautaInvalida, carregar
from .proveniencia import carregar as carregar_modulo


def _abrir(caminho: Path):
    try:
        return carregar(caminho)
    except FileNotFoundError:
        sys.exit(f"não achei a pauta: {caminho}")
    except PautaInvalida as e:
        sys.exit(f"pauta inválida — {e}")


def _conferir(p, forcar: bool) -> None:
    achados = linter.conferir(p)
    linter.relatar(p, achados)
    graves = linter.erros(achados)
    if graves and not forcar:
        sys.exit(f"\nmontagem recusada: {len(graves)} erro(s) acima. "
                 f"Para montar assim mesmo, use --forcar")
    if graves:
        print("\n--forcar: montando com os erros acima em pé\n")


# ── validar ──────────────────────────────────────────────────────────────────


def cmd_validar(args) -> None:
    p = _abrir(args.pauta)
    print(f"{p.titulo}\n{len(p.blocos)} blocos, "
          f"{sum(len(b.visuais) for b in p.blocos)} planos\n")
    achados = linter.conferir(p)
    linter.relatar(p, achados)
    sys.exit(1 if linter.erros(achados) else 0)


# ── falar ────────────────────────────────────────────────────────────────────


def cmd_falar(args) -> None:
    """
    O texto como ele é LIDO — sem as marcas de corte.

    Existe porque a gravação é o único passo que não automatiza, e o que ele
    precisa é do texto corrido, com a marca de onde respirar. Ler a pauta no
    YAML, com barras e indentação, produz exatamente a leitura dura que a
    regra 2 existe para evitar.
    """
    p = _abrir(args.pauta)
    mn = carregar_modulo("montar_neuroart")
    print(f"# {p.titulo}\n")
    print(f"ÂNGULO: {p.angulo}\n")
    print("Grave em UMA tomada, com uma pausa marcada entre blocos. "
          "A legenda é cortada depois.\n")
    total = 0.0
    for i, b in enumerate(p.blocos, start=1):
        seg = mn.silabas(b.corrido) / p.ritmo_fala
        total += seg
        print(f"[{i}]  ~{seg:.0f}s")
        print(f"{b.corrido}\n")
    print(f"total estimado: {total:.0f}s de fala "
          f"({len(p.blocos)} pausas marcadas)")


# ── sincronizar ──────────────────────────────────────────────────────────────


def cmd_sincronizar(args) -> None:
    p = _abrir(args.pauta)
    sn = carregar_modulo("sincronizar_narracao")
    if not args.audio.exists():
        sys.exit(f"não achei a gravação: {args.audio}")

    linhas = [b.corrido for b in p.blocos]
    fim = sn.duracao_total(args.audio)
    sils = sn.silencios(args.audio, args.ruido, args.pausa_min)
    # Silêncio colado no começo ou no fim é cabeça e rabo da gravação.
    candidatos = [s.meio for s in sils if 0.4 < s.meio < fim - 0.4]

    print(f"{fim:.1f}s de áudio, {len(candidatos)} pausas, {len(linhas)} blocos\n")
    trechos = sn.alinhar(linhas, candidatos, fim)

    total_sil = sum(sn.silabas(l) for l in linhas)
    suspeito = 0
    for i, ((ini, f), texto) in enumerate(zip(trechos, linhas), start=1):
        dur = f - ini
        prev = sn.silabas(texto) * fim / total_sil
        desvio = (dur - prev) / prev * 100
        ruim = abs(desvio) >= 35
        suspeito += ruim
        print(f"{i:2d}. {ini:6.2f} → {f:6.2f}  ({dur:5.2f}s, {desvio:+5.0f}%)"
              f"{' <-' if ruim else '  '} {texto[:46]}")

    tempos = ",".join(f"{f - i:.2f}" for i, f in trechos)
    print(f"\n--tempos {tempos}")
    if suspeito:
        print(f"{suspeito} bloco(s) marcado(s) com <- destoam do texto: o corte "
              f"pode ter caído na respiração errada. Confira antes de montar.")


# ── montar ───────────────────────────────────────────────────────────────────


def cmd_montar(args) -> None:
    from . import montagem

    p = _abrir(args.pauta)
    print(f"{p.titulo}\n")
    _conferir(p, args.forcar)

    tempos = [float(x) for x in args.tempos.split(",")] if args.tempos else None
    montagem.montar(p, args.saida, args.obras, args.ilustra,
                    args.voz, args.trilha, tempos)


# ── remixar ──────────────────────────────────────────────────────────────────


def cmd_remixar(args) -> None:
    """
    Refaz SÓ o áudio de um vídeo já montado.

    O render leva minutos, a mistura leva segundos, e achar o equilíbrio entre
    voz e música é questão de ouvido — refazer o vídeo a cada tentativa seria
    desperdício puro.
    """
    import shutil
    import tempfile

    p = _abrir(args.pauta)
    mn = carregar_modulo("montar_neuroart")
    volume = args.volume_trilha if args.volume_trilha is not None else p.volume_trilha
    ducking = args.ducking if args.ducking is not None else p.ducking
    tmp = Path(tempfile.mkdtemp(prefix="niche-remix-"))
    try:
        mn.mixar(args.video, args.saida, args.voz, args.trilha, volume, ducking, tmp)
        print(f"pronto: {args.saida}  (trilha {volume}, ducking {ducking})")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="niche", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="comando", required=True)

    v = sub.add_parser("validar", help="passa a pauta pelas quatro regras")
    v.add_argument("pauta", type=Path)
    v.set_defaults(func=cmd_validar)

    f = sub.add_parser("falar", help="imprime o texto corrido para gravar")
    f.add_argument("pauta", type=Path)
    f.set_defaults(func=cmd_falar)

    s = sub.add_parser("sincronizar", help="mede a gravação e devolve os tempos")
    s.add_argument("pauta", type=Path)
    s.add_argument("audio", type=Path)
    s.add_argument("--ruido", default="-32dB")
    s.add_argument("--pausa-min", type=float, default=0.30)
    s.set_defaults(func=cmd_sincronizar)

    m = sub.add_parser("montar", help="valida e renderiza o episódio")
    m.add_argument("pauta", type=Path)
    m.add_argument("--saida", type=Path, required=True)
    m.add_argument("--obras", type=Path, help="pasta com as obras")
    m.add_argument("--ilustra", type=Path, help="pasta com as ilustrações")
    m.add_argument("--voz", type=Path)
    m.add_argument("--trilha", type=Path)
    m.add_argument("--tempos", help="saída de `niche sincronizar`")
    m.add_argument("--forcar", action="store_true",
                   help="monta mesmo com erro de linter (a regra pode estar "
                        "errada; a saída dela não é lei)")
    m.set_defaults(func=cmd_montar)

    r = sub.add_parser("remixar", help="refaz só o áudio de um vídeo montado")
    r.add_argument("pauta", type=Path)
    r.add_argument("video", type=Path)
    r.add_argument("--saida", type=Path, required=True)
    r.add_argument("--voz", type=Path, required=True)
    r.add_argument("--trilha", type=Path)
    r.add_argument("--volume-trilha", type=float)
    r.add_argument("--ducking", type=float)
    r.set_defaults(func=cmd_remixar)

    args = ap.parse_args(argv)
    args.func(args)
