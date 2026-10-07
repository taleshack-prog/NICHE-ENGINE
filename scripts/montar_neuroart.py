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
import re
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

    def aparada(self) -> Image.Image:
        """A obra sem a parede e a moldura que a foto pegou nas bordas."""
        src = self.carregar()
        m = 0.025
        return src.crop((int(src.width * m), int(src.height * m),
                         int(src.width * (1 - m)), int(src.height * (1 - m))))

    def ampliacao_tela_cheia(self) -> float:
        """Quanto a obra precisa ser ESTICADA para preencher 1080x1920.

        Acima de ~1,15 a pincelada vira papa. A Frequência Abissal tem 1.323px
        de altura: preenchê-la na vertical exigiria 1,5x. Era a mesma falha que
        arruinou a versão gerada, e passou despercebida porque eu só olhei a
        largura das fotos."""
        a = self.aparada()
        return ALTURA / a.height

    def tela_cheia(self) -> Image.Image:
        """
        A obra aparada e escalada para a altura do vídeo, guardada.

        Sem o cache, cada um dos ~1.400 quadros reescalaria uma imagem de
        7127x2861 com LANCZOS: minutos de render para um resultado idêntico.
        """
        if self._cheia is None:
            src = self.aparada()
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


_NUCLEO = re.compile(r"[aeiouáàâãéêíóôõúü]+", re.IGNORECASE)


def silabas(texto: str) -> int:
    """Núcleos vocálicos. Grosseiro, mas o que importa é a PROPORÇÃO entre as
    legendas de um mesmo bloco, e para isso serve melhor que contar palavras."""
    return max(1, len(_NUCLEO.findall(texto)))


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


AMPLIACAO_MAXIMA = 1.15


def _emoldurada(obra: Obra, t: float) -> Image.Image:
    """
    A obra como objeto numa parede escura, na largura da tela.

    É o que se faz quando preencher a vertical exigiria esticar demais: em vez
    de uma pincelada borrada ocupando tudo, uma pintura nítida ocupando a faixa
    central. Perde-se área, ganha-se a textura — que numa tela de impasto é o
    assunto.
    """
    src = obra.aparada()
    larg = LARGURA - 60
    alt = int(src.height * larg / src.width)
    quadro = src.resize((larg, alt), Image.LANCZOS)

    img = tela()
    # Deriva lenta na vertical, para o plano não ficar morto.
    y = int((ALTURA * 0.46 - alt / 2) + 30 * (t - 0.5))
    img.paste(quadro, (30, y))
    d = ImageDraw.Draw(img)
    d.rectangle([30, y, 30 + larg - 1, y + alt - 1], outline=(58, 36, 92), width=2)
    return img


def plano_obra(obra: Obra, t: float, panoramica: float = 0.5) -> Image.Image:
    """
    A obra em tela cheia, atravessada lentamente — quando ela aguenta.

    Quando não aguenta (ver ampliacao_tela_cheia), cai para a versão
    emoldurada. A regra está no código porque confiar na minha atenção já
    falhou: eu olhei a largura das fotos, aprovei, e não reparei que uma delas
    tinha metade da altura necessária.
    """
    if obra.ampliacao_tela_cheia() > AMPLIACAO_MAXIMA:
        return _emoldurada(obra, t)

    grande = obra.tela_cheia()
    curso = max(grande.width - LARGURA, 0)
    suave = t * t * (3 - 2 * t)
    x = int((curso * panoramica) * suave + curso * (1 - panoramica) * 0.5)
    return grande.crop((x, 0, x + LARGURA, ALTURA))


def plano_detalhe(obra: Obra, t: float, zona: float, aperto: float = 1.0) -> Image.Image:
    """
    Um pedaço da obra, recortado do ORIGINAL e nunca esticado além do limite.

    Oito segundos atravessando uma tela só é lento: o olho entende o quadro em
    dois segundos e depois espera. Recortes em posições diferentes rendem
    planos que não se parecem.

    `zona` é a posição horizontal (0 = esquerda, 1 = direita). `aperto` é
    quanto da altura o recorte toma, mas é CORRIGIDO para baixo quando o
    recorte pedido exigiria esticar mais que AMPLIACAO_MAXIMA — a vontade de
    aproximar não pode custar nitidez.
    """
    src = obra.aparada()
    minimo = (ALTURA / AMPLIACAO_MAXIMA) / src.height
    aperto = min(1.0, max(aperto, minimo))

    alt = int(src.height * aperto)
    larg = min(src.width, int(alt * LARGURA / ALTURA))
    passo = 1.0 + 0.05 * t
    lw, lh = larg / passo, alt / passo
    cx = (larg / 2) + (src.width - larg) * zona
    cy = src.height / 2
    corte = src.crop((int(cx - lw / 2), int(cy - lh / 2),
                      int(cx + lw / 2), int(cy + lh / 2)))
    return corte.resize((LARGURA, ALTURA), Image.LANCZOS)


def plano_placa(titulo: str, destaque: str, rodape: str, t: float,
                cor: tuple[int, int, int] = CIANO) -> Image.Image:
    """
    Placa tipográfica — a versão em código dos cards do projeto.

    Os cards originais trazem o texto QUEIMADO na imagem, com os erros dentro
    ("250,000" com vírgula, rodapé em inglês, concordância de NEUROS). Corrigir
    pixel não dá; redesenhar dá, e de quebra a placa passa a usar a mesma
    paleta e a mesma fonte dos gráficos, virando um sistema só.
    """
    img = tela()
    d = ImageDraw.Draw(img)
    f_tit, f_des, f_rod = fonte(34), fonte(76), fonte(32)

    surge = min(1.0, t * 2.2)
    d.text((110, 560), titulo.upper(), font=f_tit, fill=cor)
    d.line([(110, 620), (110 + int(300 * surge), 620)], fill=cor, width=3)

    linhas_des = quebrar(destaque, f_des, LARGURA - 220)
    for i, linha in enumerate(linhas_des):
        d.text((110, 680 + i * 92), linha, font=f_des, fill=TEXTO)
    # O rodapé acompanha o destaque. Ancorado numa altura fixa, abria um vão de
    # 400px quando o destaque era curto.
    base = 680 + len(linhas_des) * 92 + 34
    for i, linha in enumerate(quebrar(rodape, f_rod, LARGURA - 220)):
        d.text((110, base + i * 46), linha, font=f_rod, fill=APAGADO)
    return img


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


def mixar(video: Path, saida: Path, voz: Path, trilha: Path | None,
          volume: float, ducking: float, tmp: Path) -> None:
    """
    Junta voz e trilha num vídeo já renderizado.

    Separado da montagem de propósito: o vídeo leva dois minutos para
    renderizar, a mistura leva cinco segundos. Como achar o equilíbrio entre
    voz e música é questão de ouvido e leva algumas tentativas, refazer o
    vídeo a cada tentativa seria desperdício puro.

    `volume` é o ganho da trilha e `ducking` quanto ela recua quando a voz
    entra. Ducking alto (12) some com a música sob a fala; baixo (4) deixa ela
    presente, respirando junto.
    """
    # A voz é normalizada ANTES, em passo separado, e não dentro do grafo.
    #
    # POR QUE SEPARADO: o loudnorm tem ~3s de lookahead. Quando a saída dele
    # alimenta um asplit cujas pontas são consumidas em ritmos diferentes (uma
    # vai para o sidechain), a cauda se perde na descarga final. Medido numa
    # gravação real: 69,57s sem loudnorm no grafo, 66,67s com ele — três
    # segundos de fala sumindo calados no fim.
    normalizada = tmp / "voz-normalizada.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(voz),
         "-af", "aformat=sample_fmts=fltp:channel_layouts=stereo,"
                "loudnorm=I=-16:TP=-1.5:LRA=11", str(normalizada)],
        check=True,
    )

    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
           "-i", str(normalizada)]
    voz_f = "[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo"
    if trilha and trilha.exists():
        cmd += ["-stream_loop", "-1", "-i", str(trilha)]
        audio = (
            f"{voz_f},asplit=2[voz][lado];"
            "[2:a]aformat=sample_fmts=fltp:channel_layouts=stereo,"
            f"volume={volume}[mus];"
            f"[mus][lado]sidechaincompress="
            f"threshold=0.05:ratio={ducking}:attack=20:release=450[duck];"
            "[voz][duck]amix=inputs=2:duration=first:normalize=0[aout]"
        )
    else:
        audio = f"{voz_f}[aout]"
    cmd += ["-filter_complex", audio, "-map", "0:v:0", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
            "-movflags", "+faststart", str(saida)]
    subprocess.run(cmd, check=True)


def montar(obras: dict[str, Obra], saida: Path, voz: Path | None,
           tempos: list[float] | None = None, trilha: Path | None = None,
           volume: float = 0.45, ducking: float = 4.0) -> None:
    kanji, abissal, metropole = obras["kanji"], obras["abissal"], obras["metropole"]

    # (duração em segundos, função que desenha, legenda)
    # As durações saem do texto: 2,6 palavras por segundo, que é ritmo de fala
    # calma. Assim a narração gravada depois encaixa sem reeditar os planos.
    # BLOCOS, não frases soltas.
    #
    # A primeira versão deste roteiro eram onze sentenças fechadas, uma por
    # legenda. O usuário tentou gravar e travou: "as frases estão muito duras,
    # não conectam". Estava certo — eu desenhei o texto na medida da legenda, e
    # ninguém fala em sentenças isoladas, fala emendando.
    #
    # A ordem certa é a inversa: escreve-se a fala corrida, grava-se corrido, e
    # a legenda é CORTADA depois. Cada bloco abaixo é uma respiração; dentro
    # dele a duração medida se reparte entre as legendas na proporção das
    # sílabas. A legenda pode quebrar no meio da frase — e fica melhor assim,
    # porque acompanha a fala em vez de interrompê-la.
    blocos: list[list[tuple[str, object]]] = [
        [("Esse quadro está na blockchain",
          lambda t: plano_detalhe(kanji, t, 0.15)),
         ("Foi dividido em cem pedaços",
          lambda t: plano_detalhe(kanji, t, 0.62, 0.62)),
         ("e cada pedaço custa cento e noventa e oito reais",
          lambda t: plano_placa("VALOR DA OBRA", "R$ 19.800",
                                "100 frações · R$ 198,00 cada", t))],

        [("Mas quem decidiu que são cem não fui eu, nem o comprador",
          lambda t: plano_obra(kanji, t * 0.4, 0.5)),
         ("Foi o artista", lambda t: plano_grades(t * 0.5)),
         ("Nessa tela ele quis cem pedaços. Em outra, mil",
          lambda t: plano_grades(0.5 + t * 0.5))],

        [("E quem compra um pedaço não leva figurinha digital",
          lambda t: plano_detalhe(abissal, t, 0.2, 0.64)),
         ("Leva fração de uma tela que existe",
          lambda t: plano_obra(abissal, t, 0.5)),
         ("pendurada numa parede",
          lambda t: plano_detalhe(abissal, t, 0.78, 0.60)),
         ("Tanto que, juntando as cem frações",
          lambda t: plano_placa("RESGATE", "100% das frações",
                                "queima os tokens e retira a obra física", t)),
         ("queima os tokens e leva a tela para casa",
          lambda t: plano_obra(kanji, 0.4 + t * 0.6, 1.0))],

        [("De cada venda, oitenta por cento vai para o artista", plano_divisao)],

        [("E olha a etiqueta de cada obra",
          lambda t: plano_detalhe(metropole, t, 0.3, 0.60)),
         ("hiperfoco, estado de fluxo",
          lambda t: plano_etiquetas([kanji, abissal, metropole], t * 0.5)),
         ("Elas são catalogadas pelo estado mental em que foram pintadas",
          lambda t: plano_etiquetas([kanji, abissal, metropole], 0.5 + t * 0.5)),
         ("porque os artistas são neurodivergentes",
          lambda t: plano_placa("ARTISTAS", "Neurodivergentes",
                                "hiperfoco · estado de fluxo", t))],

        [("Parte de cada transação financia",
          lambda t: plano_obra(metropole, t * 0.5, 0.5)),
         ("pesquisa em neurociência",
          lambda t: plano_placa("DESTINO DAS TAXAS", "Pesquisa",
                                "parte de cada transação vai para o fundo de "
                                "pesquisa em neurociência", t))],

        [("Então não, isso não é especulação",
          lambda t: plano_detalhe(kanji, t, 0.9, 0.62)),
         ("É o contrário dela",
          lambda t: plano_placa("", "Cada NEURO é fração de uma obra real",
                                "a maioria dos tokens não lastreia nada", t,
                                VERDE)),
         ("NeuroArt DApp — unindo a arte à ciência", plano_fecho)],
    ]

    # A duração de cada bloco vem medida da gravação (ver
    # scripts/sincronizar_narracao.py); sem gravação, estima-se pelo texto.
    if tempos:
        if len(tempos) != len(blocos):
            sys.exit(f"{len(tempos)} tempos para {len(blocos)} blocos")
        medidas = tempos
    else:
        medidas = [sum(silabas(l) for l, _ in b) / 5.4 for b in blocos]

    roteiro = []
    for medida, bloco in zip(medidas, blocos):
        total = sum(silabas(l) for l, _ in bloco)
        for legenda, visual in bloco:
            roteiro.append((medida * silabas(legenda) / total, visual, legenda))

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
            mixar(bruto, saida, voz, trilha, volume, ducking, tmp)
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
    ap.add_argument("--volume-trilha", type=float, default=0.45,
                    help="ganho da música (0.20 discreta, 0.45 presente, 0.70 alta)")
    ap.add_argument("--ducking", type=float, default=4.0,
                    help="quanto a música recua sob a voz (12 some, 4 respira junto)")
    ap.add_argument("--remix", type=Path,
                    help="vídeo já montado: refaz SÓ o áudio, em segundos")
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

    if args.remix:
        if not args.voz:
            sys.exit("--remix precisa de --voz")
        tmp = Path(tempfile.mkdtemp(prefix="remix-"))
        try:
            mixar(args.remix, args.saida, args.voz, args.trilha,
                  args.volume_trilha, args.ducking, tmp)
            print(f"pronto: {args.saida}  (trilha {args.volume_trilha}, "
                  f"ducking {args.ducking})")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        return

    tempos = [float(x) for x in args.tempos.split(",")] if args.tempos else None
    montar(obras, args.saida, args.voz, tempos, args.trilha,
           args.volume_trilha, args.ducking)


if __name__ == "__main__":
    main()
