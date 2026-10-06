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
    #: Clipe só serve se tiver UMA destas palavras nas tags. É a trava contra o
    #: que aconteceu na primeira montagem: "great dane standing beside woman
    #: full body" casou com "woman"/"body" e trouxe uma mulher malhando; "dog
    #: looking into camera close up eyes" casou com "eyes" e trouxe um batom.
    #: A busca do Pixabay quebra a frase em palavras soltas e casa com qualquer
    #: uma — então a relevância tem que ser conferida aqui, não pedida lá.
    exigir: tuple[str, ...] = ("dog",)
    #: Busca mais larga para quando a principal não sobrar nada após a trava.
    reserva: str = "dog"
    #: Palavras que fazem o candidato SUBIR na lista, sem eliminar quem não tem.
    #:
    #: É aqui que mora a empatia. O Pixabay ignora os modificadores da busca
    #: ("dog lap" e "dog hug" devolvem o mesmo cachorro bebendo água), então
    #: não adianta pedir a cena: pede-se "dog" e escolhe-se, entre o que
    #: voltou, o clipe que tem gente junto. Cachorro sozinho em parque informa;
    #: cachorro com uma pessoa é o que faz alguém parar de rolar a tela.
    preferir: tuple[str, ...] = ()


@dataclass
class Candidato:
    """Um clipe de banco, normalizado — o script não sabe de qual banco veio."""

    ident: str
    pagina: str
    autor: str
    link: str
    largura: int
    altura: int
    tags: str = ""

    def pontua(self, preferir: tuple[str, ...]) -> int:
        texto = f"{self.tags} {self.pagina}".lower()
        return sum(1 for p in preferir if p in texto)

    def combina(self, exigir: tuple[str, ...]) -> bool:
        # O Pexels não devolve tags, mas o endereço da página traz o título em
        # formato de slug ("/video/dog-running-on-beach-1234/"), que serve.
        texto = f"{self.tags} {self.pagina}".lower()
        return any(p in texto for p in exigir)

    @property
    def retrato(self) -> bool:
        # 1.2 e não 1.0: quadrado recortado para 9:16 já amplia demais.
        return self.altura >= self.largura * 1.2


# Narração já gerada e paga, um áudio por bloco de pontuação.
# Cada bloco carrega seus planos; a duração de cada plano sai repartida dentro
# do bloco na proporção do número de letras da linha. O erro fica preso ao
# bloco e não acumula ao longo da peça.
#
# As buscas estão em inglês de propósito: é onde o acervo do Pexels é grande.
# E quase todas pedem UMA PESSOA no quadro — é o que estava faltando.
CAO = ("dog", "puppy", "canine", "pet", "retriever", "labrador", "dane")

#: Marcas de presença humana nas tags. Não eliminam ninguém — só puxam para
#: cima. Ver Plano.preferir para o porquê.
GENTE = ("owner", "man", "woman", "human", "boy", "girl", "child", "kid",
         "people", "person", "hand", "family", "walk", "neighbours")

BLOCOS: list[tuple[str, list[Plano]]] = [
    (
        "https://v3b.fal.media/files/b/0aad3a7a/eynjXcrPeF3H-M_6jM1fg_kp6PKjuE.wav",
        [
            Plano("Esse cachorro vai pesar", "big dog", CAO, "dog"),
            Plano("mais que você", "dog paws", CAO, "dog", GENTE),
        ],
    ),
    (
        "https://v3b.fal.media/files/b/0aad3a7b/q4zuZogAwVNbj_cFdqeyo_DTZC23II.wav",
        [
            Plano("E vai continuar achando", "dog sofa", CAO, "dog home"),
            Plano("que cabe no seu colo", "dog owner", CAO, "dog", GENTE),
        ],
    ),
    (
        "https://v3b.fal.media/files/b/0aad3a61/5E9SjtFUuPhuXLCxB-d7g_jAqR4p0x.wav",
        [
            Plano("O dogue alemão vive", "dog portrait", CAO, "dog"),
            Plano("de sete a dez anos", "old dog walk", CAO, "old dog", GENTE),
            Plano("Um labrador chega aos doze", "labrador", CAO, "dog running"),
        ],
    ),
    (
        "https://v3b.fal.media/files/b/0aad3a61/DTgD43MkVNtKtWUbXBIUh_8aE36WEq.wav",
        [
            Plano("Quem escolhe um gigante", "dog man", CAO, "dog owner", GENTE),
            Plano("sabe o preço", "dog hand", CAO, "petting dog", GENTE),
            Plano("amor grande, tempo curto", "dog woman", CAO, "dog owner", GENTE),
        ],
    ),
    (
        "https://v3b.fal.media/files/b/0aad3a62/qUGkdULNuFNbhh0h5HmbI_CTvXuT5g.wav",
        [
            Plano("Salva, se você ama um deles", "boy dog", CAO, "dog face", GENTE),
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


def ler_env(nome: str) -> str | None:
    """Env primeiro; depois o .env do repositório, se existir."""
    if v := os.environ.get(nome):
        return v.strip()
    for env in (Path(__file__).resolve().parent.parent / ".env",
                Path.home() / "Downloads/NICHE-ENGINE/.env"):
        if env.exists():
            for linha in env.read_text().splitlines():
                if m := re.match(rf"\s*{nome}\s*=\s*(.+)", linha):
                    v = m.group(1).strip().strip("'\"")
                    if v:
                        return v
    return None


def escolher_banco() -> tuple[str, str]:
    """
    Devolve (banco, chave). Pexels primeiro quando há as duas chaves: o acervo
    vertical dele é maior, e vertical evita o recorte.

    O Pexels pausou a emissão de chaves novas em 06/10/2026 — por isso o
    Pixabay existe aqui, e não como luxo de abstração.
    """
    if k := ler_env("PEXELS_API_KEY"):
        return "pexels", k
    if k := ler_env("PIXABAY_API_KEY"):
        return "pixabay", k
    sys.exit(
        "falta a chave do banco de filmagem. Qualquer um dos dois serve:\n\n"
        "  PIXABAY  (funcionando hoje) — entre em https://pixabay.com/api/docs/\n"
        "           já logado; a chave aparece na própria página. Acrescente ao\n"
        "           .env:  PIXABAY_API_KEY=...\n\n"
        "  PEXELS   (emissão de chaves pausada em 06/10/2026, tente mais tarde)\n"
        "           https://www.pexels.com/api/new/ →  PEXELS_API_KEY=...\n\n"
        "Edite o .env no VSCode, não pelo terminal."
    )


# O urllib se identifica como "Python-urllib/3.x", e o WAF na frente do Pixabay
# recusa isso com 403 antes de sequer olhar a chave. Um User-Agent honesto
# resolve — e identificar quem está chamando é o certo de qualquer forma.
AGENTE = "NicheEngine/1.0 (+https://hacktechfarm.com.br)"


def baixar(url: str, destino: Path, cabecalhos: dict[str, str] | None = None) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": AGENTE, **(cabecalhos or {})})
    with urllib.request.urlopen(req, timeout=180) as resp, open(destino, "wb") as f:
        shutil.copyfileobj(resp, f)


# ─────────────────────────── Pexels ───────────────────────────


def _json(url: str, cabecalhos: dict[str, str] | None = None, banco: str = "") -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": AGENTE, **(cabecalhos or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        if e.code in (400, 401, 403, 429):
            # O corpo da resposta é onde está o diagnóstico de verdade: o
            # Pixabay devolve coisas como [ERROR 400] "key" is invalid.
            # Engolir isso e dizer "confira a chave" transforma um erro
            # explícito em adivinhação.
            try:
                corpo = e.read().decode("utf-8", "replace").strip()[:300]
            except Exception:
                corpo = ""
            dica = {
                400: "chave ausente, inválida ou com espaço sobrando",
                401: "chave não reconhecida",
                403: "bloqueio do servidor — chave inválida, conta ainda não "
                     "confirmada por e-mail, ou requisição recusada antes de chegar à API",
                429: "limite de requisições atingido; espere um minuto",
            }[e.code]
            sys.exit(f"{banco}: HTTP {e.code} — {dica}."
                     + (f"\nresposta do servidor: {corpo}" if corpo else ""))
        raise


def _melhor(arquivos: list[tuple[str, int, int]]) -> tuple[str, int, int] | None:
    """
    O arquivo mais perto de 1920 de altura. Nem o 4K (minutos de download para
    ser reduzido depois) nem o 360p. Retrato ganha empate.
    """
    uteis = [a for a in arquivos if a[0] and a[1] and a[2]]
    if not uteis:
        return None
    return max(uteis, key=lambda a: (1 if a[2] >= a[1] * 1.2 else 0, -abs(a[2] - 1920)))


def buscar_pexels(termo: str, chave: str) -> list[Candidato]:
    """Verticais primeiro; completa com qualquer orientação se faltar."""
    saida, vistos = [], set()
    for orientacao in ("portrait", None):
        p = {"query": termo, "per_page": CANDIDATOS, "size": "medium"}
        if orientacao:
            p["orientation"] = orientacao
        dados = _json("https://api.pexels.com/v1/videos/search?" + urllib.parse.urlencode(p),
                      {"Authorization": chave}, "Pexels")
        for v in dados.get("videos", []):
            if v["id"] in vistos:
                continue
            vistos.add(v["id"])
            melhor = _melhor([(f.get("link"), f.get("width"), f.get("height"))
                              for f in v.get("video_files", [])])
            if melhor:
                saida.append(Candidato(str(v["id"]), v.get("url", ""),
                                       v.get("user", {}).get("name", "?"), *melhor))
        if len(saida) >= CANDIDATOS:
            break
    return saida


def buscar_pixabay(termo: str, chave: str) -> list[Candidato]:
    """
    O Pixabay NÃO tem filtro de orientação em vídeo (confirmado na doc da API),
    e o acervo é quase todo horizontal. Então aqui a ordenação é nossa: retrato
    primeiro, horizontal depois — e o horizontal entra pela composição com
    fundo desfocado, nunca por recorte de 3x no centro.
    """
    p = {"key": chave, "q": termo, "per_page": CANDIDATOS,
         "video_type": "film", "safesearch": "true"}
    dados = _json("https://pixabay.com/api/videos/?" + urllib.parse.urlencode(p),
                  None, "Pixabay")
    saida = []
    for h in dados.get("hits", []):
        melhor = _melhor([(v.get("url"), v.get("width"), v.get("height"))
                          for v in h.get("videos", {}).values()])
        if melhor:
            saida.append(Candidato(str(h["id"]), h.get("pageURL", ""),
                                   h.get("user", "?"), *melhor, tags=h.get("tags", "")))
    saida.sort(key=lambda c: 0 if c.retrato else 1)
    return saida


def buscar(plano: Plano, chave: str, banco: str = "") -> list[Candidato]:
    """
    Busca, e só devolve o que PASSA NA TRAVA DE RELEVÂNCIA. Um clipe sem
    cachorro nas tags não é um candidato ruim, é um candidato errado: entregar
    uma mulher malhando numa peça sobre dogue alemão não é questão de gosto.
    """
    motor = buscar_pexels if banco == "pexels" else buscar_pixabay
    for termo in (plano.busca, plano.reserva):
        achados = [c for c in motor(termo, chave) if c.combina(plano.exigir)]
        if achados:
            # Ordem estável: mais pessoas primeiro, vertical desempata.
            achados.sort(key=lambda c: (-c.pontua(plano.preferir), 0 if c.retrato else 1))
            return achados
    return []


def obter_clipe(cand: Candidato) -> Path:
    destino = CACHE / f"{cand.ident}.mp4"
    if not destino.exists() or destino.stat().st_size == 0:
        baixar(cand.link, destino)
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


def enquadrar(retrato: bool) -> str:
    """
    O filtro que leva o clipe ao 9:16, e é onde se ganha ou se perde nitidez.

    RETRATO: preenche a tela inteira. Escala até cobrir e corta as sobras —
    perda mínima, porque a origem já é alta.

    HORIZONTAL: NÃO preenche por recorte. Encher 1080x1920 com o centro de um
    1920x1080 significa ampliar 3,2x o miolo do quadro; é exatamente a textura
    borrada que a versão gerada tinha. Em vez disso, recorta um 4:5 do centro
    (864x1080 num Full HD — ampliação de 1,25x, ainda nítida), ocupa 70% da
    altura, e o resto é o mesmo quadro desfocado e escurecido atrás. O desfoque
    é feito em miniatura e remontado: mesmo resultado, uma fração do custo.
    """
    if retrato:
        return (f"scale={LARGURA}:{ALTURA}:force_original_aspect_ratio=increase,"
                f"crop={LARGURA}:{ALTURA},fps={FPS},"
                f"tpad=stop_mode=clone:stop_duration=3,format=yuv420p")

    alt_fg = round(LARGURA * 1.25)  # 4:5
    return (
        "split=2[bg][fg];"
        f"[bg]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,"
        f"gblur=sigma=12,scale={LARGURA}:{ALTURA},eq=brightness=-0.15[fundo];"
        f"[fg]crop=ih*0.8:ih,scale={LARGURA}:{alt_fg}[frente];"
        f"[fundo][frente]overlay=(W-w)/2:(H-h)/2,fps={FPS},"
        f"tpad=stop_mode=clone:stop_duration=3,format=yuv420p"
    )


def recortar(origem: Path, destino: Path, duracao_ms_alvo: int, retrato: bool) -> None:
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

    rodar([
        "ffmpeg", "-y", "-loglevel", "error", "-accurate_seek",
        "-ss", f"{inicio:.3f}", "-i", str(origem),
        "-t", f"{dur_s:.3f}", "-filter_complex", enquadrar(retrato), "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-video_track_timescale", "90000", str(destino),
    ])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trocar", action="append", default=[], metavar="PLANO=INDICE",
                    help="usa outro candidato naquele plano, ex: --trocar 3=1")
    ap.add_argument("--saida", default=str(Path.home() / "Downloads/dogue-real.mp4"))
    ap.add_argument("--conferir", action="store_true",
                    help="mostra o que cada busca traz, sem baixar nem montar")
    ap.add_argument("--testar-chave", action="store_true",
                    help="só confere se a credencial passa, sem montar nada")
    args = ap.parse_args()

    if args.testar_chave:
        banco, chave = escolher_banco()
        print(f"banco: {banco}  chave: {chave[:4]}…{chave[-4:]} ({len(chave)} caracteres)")
        achados = buscar(Plano("teste", "dog"), chave, banco)
        print(f"OK — {len(achados)} resultados para 'dog'.")
        for c in achados[:3]:
            orient = "vertical" if c.retrato else "horizontal"
            print(f"  {c.largura}x{c.altura} {orient}  {c.autor}  {c.pagina}")
        return

    if args.conferir:
        # Conferir é de graça; montar e assistir custa o seu tempo. Depois de
        # entregar uma peça com uma mulher malhando e um batom numa narração
        # sobre dogue alemão, este passo vem antes, não depois.
        banco, chave = escolher_banco()
        usados: set[str] = set()
        n = 0
        for _, lista in BLOCOS:
            for plano in lista:
                n += 1
                achados = buscar(plano, chave, banco)
                if not achados:
                    print(f"{n:2d}. {plano.linha}\n    NADA passou na trava "
                          f"({plano.busca!r} / {plano.reserva!r})")
                    continue
                esc = next((c for c in achados if c.ident not in usados), achados[0])
                usados.add(esc.ident)
                print(f"{n:2d}. {plano.linha}   [{plano.busca}] "
                      f"{len(achados)} candidatos")
                for i, c in enumerate(achados[:4]):
                    marca = "<-" if c is esc else "  "
                    gente = "GENTE" if c.pontua(plano.preferir) else "  só cão"
                    print(f"    {marca} {i}: [{gente}] {c.tags[:52] or '(sem tags)'}")
                    print(f"       {c.pagina}")
        return

    escolhas: dict[int, int] = {}
    for t in args.trocar:
        if not re.fullmatch(r"\d+=\d+", t):
            sys.exit(f"--trocar espera PLANO=INDICE, recebi {t!r}")
        p, i = t.split("=")
        escolhas[int(p)] = int(i)

    banco, chave = escolher_banco()
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
        print(f"buscando {len(planos)} clipes ({banco})…")
        pedacos, creditos, cues = [], [], []
        usados: set[str] = set()
        for n, (plano, ini, dur) in enumerate(planos, start=1):
            cues.append((ini, ini + dur, plano.linha))
            resultados = buscar(plano, chave, banco)
            if not resultados:
                sys.exit(f"plano {n}: nenhum resultado para {plano.busca!r}. "
                         f"Troque a busca nessa linha do script.")
            idx = escolhas.get(n, 0)
            if idx >= len(resultados):
                sys.exit(f"plano {n}: só há {len(resultados)} candidatos, "
                         f"índices 0 a {len(resultados) - 1}.")
            # Buscas vizinhas ("great dane close up" e "old dog close up")
            # devolvem o mesmo clipe, e repetir a mesma imagem com poucos
            # segundos de distância é das coisas que o olho pega primeiro.
            # Escolha explícita do --trocar manda; fora isso, pula o repetido.
            if n in escolhas:
                cand = resultados[idx]
            else:
                cand = next((c for c in resultados if c.ident not in usados), resultados[0])
            usados.add(cand.ident)
            origem = obter_clipe(cand)
            corte = tmp / f"plano-{n:02d}.mp4"
            recortar(origem, corte, dur, cand.retrato)
            pedacos.append(corte)
            creditos.append((n, plano.linha, cand, len(resultados)))
            marca = "vertical" if cand.retrato else "horizontal+fundo"
            print(f"  {n:2d}. {dur/1000:4.1f}s  {plano.linha}  [{marca}]")

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
        for n, linha, c, total in creditos:
            print(f"  {n:2d}. {linha}\n      {c.pagina}  ({total} candidatos)")
        print("\ncréditos para a legenda do post:")
        autores = sorted({c.autor for _, _, c, _ in creditos})
        print(f"      Vídeos: {', '.join(autores)} / {banco.capitalize()}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
