#!/usr/bin/env python3
"""
Monta a peça do NeuroArt: obras reais + números reais, em 9:16.

Nenhum plano é gerado por IA e nenhum vem de banco de imagem. As telas são as
obras tokenizadas; os números (frações, preço, 80/20) são os da galeria. É o
que torna a peça impossível de copiar — e o que a tira da definição de conteúdo
inautêntico do YouTube, que é "narração sintética sobre slideshow de stock".

    python3 scripts/montar_neuroart.py --saida ~/Downloads/neuroart.mp4

Sem áudio de propósito: a narração é gravada por cima, na voz do autor. As
legendas já estão cronometradas em ritmo de fala (2,6 palavras por segundo),
então a gravação deve encaixar quase direto.

    --voz arquivo.m4a    mixa a narração e reajusta a duração à voz
"""

from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

LARGURA, ALTURA, FPS = 1080, 1920, 30

FUNDO = (10, 4, 21)
TEXTO = (239, 234, 255)
APAGADO = (142, 125, 181)
CIANO = (34, 227, 240)
VIOLETA = (167, 108, 255)
VERDE = (43, 217, 139)

RAIZ = Path(__file__).resolve().parent.parent
FONTE_ARQ = next(
    (p for p in (RAIZ / "assets/fontes/Poppins-Bold.ttf",
                 Path("/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"),
                 Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
     if p.exists()),
    None,
)


@dataclass
class Obra:
    titulo: str
    arquivo: Path
    etiqueta: str
    fracoes: int
    valor_brl: int
    imagem: Image.Image | None = field(default=None, repr=False)
    _cheia: Image.Image | None = field(default=None, repr=False)

    def carregar(self) -> Image.Image:
        if self.imagem is None:
            self.imagem = Image.open(self.arquivo).convert("RGB")
        return self.imagem

    def tela_cheia(self) -> Image.Image:
        """
        A obra aparada e escalada para a altura do vídeo, guardada.

        Sem o cache, cada um dos ~1.400 quadros reescalaria uma imagem de
        7127x2861 com LANCZOS: minutos de render para um resultado idêntico.
        """
        if self._cheia is None:
            src = self.carregar()
            # As fotos trazem um dedo de parede e moldura nas bordas; em tela
            # cheia isso vira uma faixa cinza que o olho lê como erro de
            # enquadramento.
            m = 0.025
            src = src.crop((int(src.width * m), int(src.height * m),
                            int(src.width * (1 - m)), int(src.height * (1 - m))))
            self._cheia = src.resize(
                (int(src.width * ALTURA / src.height), ALTURA), Image.LANCZOS
            )
        return self._cheia


#: Títulos como estão na galeria — o nome do arquivo perde os acentos.
TITULOS = {
    "kanji": "White Kanji",
    "abissal": "Frequência Abissal",
    "metropole": "Metrópole Suspensa",
}


def fonte(tam: int) -> ImageFont.FreeTypeFont:
    if FONTE_ARQ is None:
        return ImageFont.load_default()
    return ImageFont.truetype(str(FONTE_ARQ), tam)


# ───────────────────────── blocos de desenho ─────────────────────────


def tela() -> Image.Image:
    return Image.new("RGB", (LARGURA, ALTURA), FUNDO)


def quebrar(texto: str, fnt: ImageFont.FreeTypeFont, largura: int) -> list[str]:
    linhas, atual = [], ""
    desenho = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    for palavra in texto.split():
        teste = f"{atual} {palavra}".strip()
        if desenho.textlength(teste, font=fnt) <= largura:
            atual = teste
        else:
            if atual:
                linhas.append(atual)
            atual = palavra
    if atual:
        linhas.append(atual)
    return linhas


_CACHE_LEGENDA: dict[str, tuple[Image.Image, Image.Image]] = {}


def _camada_legenda(texto: str) -> tuple[Image.Image, Image.Image]:
    """
    Monta (cor, máscara) da faixa de legenda UMA vez por texto.

    O véu e o degradê dependem só do texto, não do quadro. Recalcular isso a
    cada quadro custou nove minutos de render sem terminar — e o resultado era
    idêntico 1.365 vezes seguidas.

    O véu existe porque a legenda cai sobre pintura: sem ele, palavra branca
    sobre respingo branco some. Contorno em volta da letra resolveria a
    leitura, mas sujaria a tipografia; o véu preserva as duas.
    """
    if texto in _CACHE_LEGENDA:
        return _CACHE_LEGENDA[texto]

    fnt = fonte(54)
    linhas = quebrar(texto.upper(), fnt, LARGURA - 180)
    topo = ALTURA - 300 - len(linhas) * 68

    cor = Image.new("RGB", (LARGURA, ALTURA), FUNDO)
    mascara = Image.new("L", (LARGURA, ALTURA), 0)
    dm = ImageDraw.Draw(mascara)
    inicio = max(topo - 120, 0)
    for y in range(inicio, ALTURA):
        t = (y - inicio) / max(ALTURA - inicio, 1)
        dm.line([(0, y), (LARGURA, y)], fill=int(205 * min(1.0, t * 1.8)))

    dc = ImageDraw.Draw(cor)
    for i, linha in enumerate(linhas):
        larg = dc.textlength(linha, font=fnt)
        x, y = (LARGURA - larg) / 2, topo + i * 68
        dc.text((x, y), linha, font=fnt, fill=TEXTO)
        dm.text((x, y), linha, font=fnt, fill=255)

    _CACHE_LEGENDA[texto] = (cor, mascara)
    return cor, mascara


def escrever_legenda(img: Image.Image, texto: str, opacidade: float = 1.0) -> None:
    if opacidade <= 0:
        return
    cor, mascara = _camada_legenda(texto)
    if opacidade < 1.0:
        mascara = mascara.point(lambda v: int(v * opacidade))
    img.paste(cor, (0, 0), mascara)


def plano_obra(obra: Obra, t: float, panoramica: float = 0.5) -> Image.Image:
    """
    A obra ocupando a tela inteira, com deslocamento horizontal lento.

    As telas são panorâmicas (2,5:1) e a tela do celular é 0,56:1. Em vez de
    encolher a pintura num retângulo no meio do quadro, atravessa-se ela — que
    é como se olha um quadro largo de perto. E como a origem tem 7000px de
    largura, o recorte vertical ainda é REDUÇÃO de escala: a pintura fica
    nítida, ao contrário de qualquer imagem gerada que precisasse ser ampliada.
    """
    grande = obra.tela_cheia()
    curso = max(grande.width - LARGURA, 0)
    # Suaviza início e fim: um movimento que começa e termina parando lê como
    # câmera conduzida, não como rolagem automática.
    suave = t * t * (3 - 2 * t)
    x = int((curso * panoramica) * suave + curso * (1 - panoramica) * 0.5)
    return grande.crop((x, 0, x + LARGURA, ALTURA))


def plano_grades(t: float) -> Image.Image:
    """
    Duas grades com a MESMA pegada: 100 frações e 1.000. Mesma obra, mesmo
    valor total, divisões diferentes — porque quem escolhe é o artista.

    A caixa é do mesmo tamanho nas duas de propósito. Deixar a grade de 1.000
    crescer para baixo faria o espectador ler "mais frações, mais área, mais
    valor", que é o oposto do que está sendo dito: o bolo é o mesmo, muda o
    tamanho da fatia.
    """
    img = tela()
    d = ImageDraw.Draw(img)
    f_rot = fonte(40)
    f_num = fonte(68)
    f_leg = fonte(28)

    caixa = 400
    topo = 700
    for lado, (total, colunas, cor, rotulo, unit) in enumerate((
        (100, 10, CIANO, "100 FRAÇÕES", "R$ 198,00"),
        (1000, 25, VIOLETA, "1.000 FRAÇÕES", "R$ 19,80"),
    )):
        cx = LARGURA * (0.27 if lado == 0 else 0.73)
        linhas = total // colunas
        px, py = caixa / colunas, caixa / linhas
        ponto = max(1.8, min(px, py) * 0.40)
        x0, y0 = cx - caixa / 2, topo
        preenchidos = int(total * min(1.0, t * 1.35))
        for i in range(total):
            cl, ln = i % colunas, i // colunas
            ex, ey = x0 + cl * px + px / 2, y0 + ln * py + py / 2
            d.ellipse([ex - ponto, ey - ponto, ex + ponto, ey + ponto],
                      fill=cor if i < preenchidos else (36, 18, 64))

        d.text((cx - d.textlength(rotulo, font=f_rot) / 2, topo - 86), rotulo,
               font=f_rot, fill=cor)
        base = topo + caixa + 64
        d.text((cx - d.textlength(unit, font=f_num) / 2, base), unit,
               font=f_num, fill=TEXTO)
        d.text((cx - d.textlength("POR FRAÇÃO", font=f_leg) / 2, base + 88),
               "POR FRAÇÃO", font=f_leg, fill=APAGADO)
    return img


def plano_divisao(t: float) -> Image.Image:
    """A barra 80/20 se formando. Um número, uma barra, nada mais."""
    img = tela()
    d = ImageDraw.Draw(img)
    larg, alt, x0 = 840, 110, 120
    y0 = 880
    avanco = min(1.0, t * 1.6)

    d.rounded_rectangle([x0, y0, x0 + larg, y0 + alt], 12, fill=(36, 18, 64))
    corte = int(larg * 0.8 * avanco)
    if corte > 12:
        d.rounded_rectangle([x0, y0, x0 + corte, y0 + alt], 12, fill=VERDE)

    f_g = fonte(130)
    f_m = fonte(38)
    d.text((x0, y0 - 190), f"{int(80 * avanco)}%", font=f_g, fill=VERDE)
    d.text((x0, y0 + alt + 40), "PARA O ARTISTA", font=f_m, fill=TEXTO)
    if avanco >= 1.0:
        rot = "20% PLATAFORMA"
        d.text((x0 + larg - d.textlength(rot, font=fonte(30)), y0 + alt + 46),
               rot, font=fonte(30), fill=APAGADO)
    return img


_CACHE_CARTAO: dict[tuple[str, int, int], Image.Image] = {}


def _cartao(obra: Obra, largura: int, altura: int) -> Image.Image:
    """Faixa central da obra, no tamanho do cartão. Guardada pelo mesmo motivo
    da legenda: o resize não muda entre quadros."""
    chave = (obra.titulo, largura, altura)
    if chave not in _CACHE_CARTAO:
        src = obra.carregar()
        r = src.resize((largura, int(src.height * largura / src.width)), Image.LANCZOS)
        if r.height > altura:
            meio = r.height // 2
            r = r.crop((0, meio - altura // 2, largura, meio + altura // 2))
        _CACHE_CARTAO[chave] = r
    return _CACHE_CARTAO[chave]


def plano_etiquetas(obras: list[Obra], t: float) -> Image.Image:
    """
    As três obras empilhadas, com a etiqueta de cada uma acendendo em sequência.
    É o detalhe que explica o projeto sem frase de marketing: as telas são
    catalogadas pelo estado mental em que foram pintadas.
    """
    img = tela()
    d = ImageDraw.Draw(img)
    f_et = fonte(34)
    f_tit = fonte(30)

    alt_cartao = 270
    topo0 = 300
    passo = alt_cartao + 86
    for i, obra in enumerate(obras):
        recorte = _cartao(obra, 880, alt_cartao)
        y = topo0 + i * passo
        img.paste(recorte, (100, y))

        # A etiqueta entra depois do cartão, uma por vez.
        surge = min(1.0, max(0.0, t * 3.2 - i * 0.75))
        if surge > 0:
            pad = 20
            largura_et = d.textlength(obra.etiqueta.upper(), font=f_et) + pad * 2
            cx = 124
            cor = (*CIANO, int(230 * surge))
            cap = Image.new("RGBA", (LARGURA, ALTURA), (0, 0, 0, 0))
            dc = ImageDraw.Draw(cap)
            dc.rounded_rectangle([cx, y + 20, cx + largura_et, y + 78], 29,
                                 fill=(10, 4, 21, int(220 * surge)), outline=cor, width=2)
            dc.text((cx + pad, y + 32), obra.etiqueta.upper(), font=f_et, fill=cor)
            img.paste(Image.alpha_composite(img.convert("RGBA"), cap).convert("RGB"))
        d.text((100, y + alt_cartao + 16), obra.titulo.upper(), font=f_tit, fill=APAGADO)
    return img


def plano_fecho(t: float) -> Image.Image:
    """Fundo limpo com um pulso de luz: o único plano sem dado, e é o fecho."""
    img = tela()
    brilho = Image.new("RGB", (LARGURA, ALTURA), FUNDO)
    d = ImageDraw.Draw(brilho)
    raio = int(260 + 120 * math.sin(t * math.pi))
    d.ellipse([LARGURA / 2 - raio, 720 - raio, LARGURA / 2 + raio, 720 + raio],
              fill=(26, 12, 52))
    return Image.blend(img, brilho.filter(ImageFilter.GaussianBlur(70)), 0.9)


# ───────────────────────── a peça ─────────────────────────


def montar(obras: dict[str, Obra], saida: Path, voz: Path | None,
           tempos: list[float] | None = None, trilha: Path | None = None) -> None:
    kanji, abissal, metropole = obras["kanji"], obras["abissal"], obras["metropole"]

    # (duração em segundos, função que desenha, legenda)
    # As durações saem do texto: 2,6 palavras por segundo, que é ritmo de fala
    # calma. Assim a narração gravada depois encaixa sem reeditar os planos.
    roteiro = [
        (4.0, lambda t: plano_obra(kanji, t, 0.55),
         "Esse quadro está na blockchain, dividido em cem pedaços"),
        (3.5, lambda t: plano_obra(kanji, 0.55 + t * 0.4, 1.0),
         "Cento e noventa e oito reais cada um"),
        (4.5, plano_grades,
         "Em quantos pedaços? Quem decide é o artista"),
        (6.0, lambda t: plano_obra(abissal, t, 0.6),
         "Quem compra não leva uma figurinha digital. Leva fração de uma tela que existe"),
        (5.5, lambda t: plano_obra(abissal, 0.6 + t * 0.4, 1.0),
         "Quem juntar as cem queima os tokens e leva a tela para casa"),
        (4.5, plano_divisao,
         "Oitenta por cento de cada venda vai para o artista"),
        (3.0, lambda t: plano_etiquetas([kanji, abissal, metropole], t * 0.5),
         "Repara na etiqueta de cada obra"),
        (4.5, lambda t: plano_etiquetas([kanji, abissal, metropole], 0.5 + t * 0.5),
         "Elas são catalogadas pelo estado mental em que foram pintadas"),
        (2.5, lambda t: plano_obra(metropole, t * 0.5, 0.5),
         "Porque os artistas são neurodivergentes"),
        (4.0, lambda t: plano_obra(metropole, 0.5 + t * 0.5, 1.0),
         "Parte de cada transação financia pesquisa em neurociência"),
        (3.5, plano_fecho, "Não é especulação. É o contrário dela"),
        (3.5, lambda t: plano_fecho(0.5 + t * 0.5),
         "NeuroArt DApp — unindo a arte à ciência"),
    ]

    if tempos:
        # Os tempos vêm medidos da narração gravada (ver
        # scripts/sincronizar_narracao.py). Casar o plano com a fala é o que
        # separa um vídeo legendado de um vídeo montado.
        if len(tempos) != len(roteiro):
            sys.exit(f"{len(tempos)} tempos para {len(roteiro)} planos")
        roteiro = [(t, f, l) for t, (_, f, l) in zip(tempos, roteiro)]

    tmp = Path(tempfile.mkdtemp(prefix="neuroart-"))
    try:
        total_s = sum(d for d, _, _ in roteiro)
        print(f"{len(roteiro)} planos, {total_s:.1f}s")

        # Os quadros vão CRUS para o ffmpeg pelo cano, em vez de virarem PNG no
        # disco. Medido: desenhar um quadro custa de 1 a 80 ms, gravá-lo como
        # PNG custa 760 ms — o render inteiro passava de quinze minutos por
        # causa do disco, não do desenho.
        bruto = tmp / "bruto.mp4"
        ff = subprocess.Popen(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-f", "rawvideo", "-pix_fmt", "rgb24",
             "-s", f"{LARGURA}x{ALTURA}", "-r", str(FPS), "-i", "-",
             "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "medium",
             "-crf", "19", str(bruto)],
            stdin=subprocess.PIPE,
        )
        assert ff.stdin is not None
        for i, (dur, desenhar, legenda) in enumerate(roteiro, start=1):
            quadros = int(dur * FPS)
            for q in range(quadros):
                t = q / max(quadros - 1, 1)
                img = desenhar(t)
                # A legenda entra e sai em 0,4s: aparecer de supetão a cada
                # corte vira piscada.
                entrada = min(1.0, q / (FPS * 0.4))
                saida_f = min(1.0, (quadros - q) / (FPS * 0.4))
                escrever_legenda(img, legenda, min(entrada, saida_f))
                ff.stdin.write(img.tobytes())
            print(f"  {i:2d}. {dur:4.1f}s  {legenda[:54]}")
        ff.stdin.close()
        if ff.wait() != 0:
            sys.exit("ffmpeg falhou ao codificar")

        saida.parent.mkdir(parents=True, exist_ok=True)
        if voz and voz.exists():
            # A voz é normalizada ANTES, em passo separado, e não dentro do
            # grafo de mixagem.
            #
            # POR QUE SEPARADO: o loudnorm tem ~3s de lookahead. Quando a saída
            # dele alimenta um asplit cujas duas pontas são consumidas em
            # ritmos diferentes (uma vai para o sidechain), a cauda se perde na
            # descarga final. Medido nesta gravação: 69,57s sem loudnorm no
            # grafo, 66,67s com ele — quase três segundos de fala sumindo no
            # fim, calados.
            normalizada = tmp / "voz-normalizada.wav"
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(voz),
                 "-af", "aformat=sample_fmts=fltp:channel_layouts=stereo,"
                        "loudnorm=I=-16:TP=-1.5:LRA=11",
                 str(normalizada)],
                check=True,
            )
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(bruto),
                   "-i", str(normalizada)]
            voz_f = "[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo"
            if trilha and trilha.exists():
                cmd += ["-stream_loop", "-1", "-i", str(trilha)]
                audio = (
                    f"{voz_f},asplit=2[voz][lado];"
                    "[2:a]aformat=sample_fmts=fltp:channel_layouts=stereo,"
                    "volume=0.20[mus];"
                    "[mus][lado]sidechaincompress="
                    "threshold=0.03:ratio=12:attack=15:release=350[duck];"
                    "[voz][duck]amix=inputs=2:duration=first:normalize=0[aout]"
                )
            else:
                audio = f"{voz_f}[aout]"
            cmd += ["-filter_complex", audio, "-map", "0:v:0", "-map", "[aout]",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
                    "-movflags", "+faststart", str(saida)]
            subprocess.run(cmd, check=True)
        else:
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(bruto),
                            "-c", "copy", "-movflags", "+faststart", str(saida)],
                           check=True)
        print(f"\npronto: {saida}  ({total_s:.1f}s)")
        if not voz:
            print("sem narração — grave a voz e rode de novo com --voz arquivo.m4a")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--obras", type=Path, required=True,
                    help="pasta com white-kanji.jpg, frequencia-abissal.jpg, "
                         "metropole-suspensa.jpg")
    ap.add_argument("--saida", type=Path, default=Path.home() / "Downloads/neuroart.mp4")
    ap.add_argument("--voz", type=Path, help="narração gravada, para mixar")
    ap.add_argument("--trilha", type=Path, help="música de fundo, entra sob a voz")
    ap.add_argument("--tempos", help="duração de cada plano em segundos, separadas por "
                                     "vírgula (saída de sincronizar_narracao.py)")
    args = ap.parse_args()

    arquivos = {
        "kanji": ("white-kanji", "Estado de Fluxo", 100, 19800),
        "abissal": ("frequencia-abissal", "Hiperfoco", 1000, 18200),
        "metropole": ("metropole-suspensa", "Hiperfoco", 1000, 17500),
    }
    obras = {}
    for chave, (base, etiqueta, fracoes, valor) in arquivos.items():
        achado = next((p for p in args.obras.iterdir()
                       if p.stem.lower().startswith(base)), None)
        if achado is None:
            sys.exit(f"não achei {base}.* em {args.obras}")
        obras[chave] = Obra(TITULOS[chave], achado, etiqueta, fracoes, valor)

    tempos = [float(x) for x in args.tempos.split(",")] if args.tempos else None
    montar(obras, args.saida, args.voz, tempos, args.trilha)


if __name__ == "__main__":
    main()
