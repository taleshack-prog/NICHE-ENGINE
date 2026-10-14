#!/usr/bin/env python3
"""
As quatro regras que decidem se uma pauta pode virar vídeo.

CADA REGRA EXISTE POR CAUSA DE UM ERRO QUE JÁ ACONTECEU nesta operação, e
nenhuma delas é opinião sobre estilo:

  1. ÂNGULO — o episódio 2 começou como "os quatro pilares científicos", uma
     lista. A pesquisa mostrou que só um dos quatro tem meta-análise por trás.
     Com tese, a ordem dos pilares muda e o episódio tem o que dizer; sem
     tese, são quatro itens com o mesmo peso aparente, que é desinformação por
     diagramação.

  2. FALA CORRIDA — a primeira versão do roteiro do episódio 1 eram onze
     sentenças fechadas, uma por legenda. O usuário tentou gravar e travou:
     "as frases estão muito duras, não conectam, não fica natural". A regra
     mede o que diferencia fala de legenda escrita.

  3. TEMPO VERBAL DE PRODUTO — eu escrevi a interface cérebro-computador como
     pilar existente. O usuário corrigiu: "BCI é roadmap". Afirmar entrega que
     não existe é o tipo de coisa que custa o canal, não só a credibilidade.

  4. FONTE PARA NÚMERO — "dezoito estudos, quase quinhentas crianças" é
     verificável ou é invenção, e a diferença não aparece no vídeo. Número sem
     fonte declarada não passa.

ERRO barra a montagem. AVISO não — é julgamento, e julgamento é do autor.
A separação é proposital: regra mecânica manda, regra de gosto opina.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .pauta import Pauta, SILENCIO
from .proveniencia import carregar

# ── vocabulários ─────────────────────────────────────────────────────────────

# Uma tese contrasta ou explica. Um tema só nomeia.
MARCAS_DE_TESE = (
    "só ", "apenas ", "não ", "mas ", "porém", "em vez de", "ao contrário",
    "apesar", "porque", "enquanto", "embora", "nenhum", "nem ", "e não",
    "o único", "a única", "mais forte", "mais fraco", "primeiro", "antes de",
)

# Palavra com que um bloco EMENDA no anterior. Fala encadeia; texto escrito
# começa cada parágrafo do zero.
CONECTIVOS = (
    "e", "mas", "então", "porque", "por isso", "aí", "só que", "tanto que",
    "de", "ou seja", "agora", "daí", "aliás", "inclusive", "e olha", "até",
    "sendo", "assim", "quer dizer", "no fim", "por fim",
)
# Os de duas palavras ("por isso") não dariam conta num teste de primeira
# palavra: "por" sozinho não é conectivo.
_RE_CONECTIVO = re.compile(
    r"\s*(" + "|".join(sorted(CONECTIVOS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE)

# O que marca uma afirmação como coisa que AINDA NÃO existe.
MARCAS_DE_ROADMAP = (
    "ainda não", "não existe", "próximo passo", "roadmap", "vai ser",
    "será", "pretende", "objetivo", "planejad", "em desenvolvimento",
    "não é uma entrega", "quando existir", "a ideia é", "queremos",
)

# O que marca uma afirmação no futuro — proibido para o que já está entregue.
#
# "vai" solto ficou FORA: em "oitenta por cento vai para o artista" ele é
# presente, e essa é uma das frases centrais do episódio 1. Só as formas
# perifrásticas com verbo de existência entram.
MARCAS_DE_FUTURO = ("vai ser", "vai ter", "vai existir", "vão ser", "vão ter",
                    "será", "serão", "pretende", "em breve", "planejamos",
                    "quando tiver", "quando existir", "um dia")

# Numeral escrito. "um"/"uma" ficam FORA de propósito: são artigo em
# praticamente todo uso ("uma tela", "um pedaço") e marcariam quase toda fala.
NUMERAIS = (
    "dois", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
    "dez", "onze", "doze", "treze", "quatorze", "catorze", "quinze",
    "dezesseis", "dezessete", "dezoito", "dezenove", "vinte", "trinta",
    "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa",
    "cem", "cento", "duzentos", "duzentas", "trezentos", "trezentas",
    "quatrocentos", "quinhentos", "quinhentas", "seiscentos", "setecentos",
    "oitocentos", "novecentos", "mil", "milhão", "milhões", "bilhão",
    "bilhões", "metade", "dobro", "triplo", "dezenas", "centenas", "milhares",
)
_RE_NUMERAL = re.compile(r"\b(" + "|".join(NUMERAIS) + r")\b", re.IGNORECASE)
_RE_DIGITO = re.compile(r"\d")
_RE_PERCENTUAL = re.compile(r"por cento|%", re.IGNORECASE)

# Legenda com mais linhas que isso é parede de texto: o olho lê o bloco
# inteiro antes de a voz chegar na metade.
LINHAS_MAXIMAS = 4

# Respiração que ninguém grava de uma vez / bloco curto que sai entrecortado.
SEGUNDOS_MAXIMOS, SEGUNDOS_MINIMOS = 12.0, 1.8


@dataclass
class Achado:
    grau: str  # "erro" | "aviso"
    regra: str
    onde: str
    texto: str

    def __str__(self) -> str:
        marca = "ERRO " if self.grau == "erro" else "aviso"
        return f"{marca} [{self.regra}] {self.onde}: {self.texto}"


def _normal(s: str) -> str:
    return re.sub(r"[^\wà-ÿ ]+", " ", s.lower()).strip()


# ── regra 1: ângulo ──────────────────────────────────────────────────────────


def regra_angulo(p: Pauta) -> list[Achado]:
    achados = []
    a = p.angulo.strip()
    if len(a) < 40:
        achados.append(Achado("erro", "ângulo", "pauta",
                              f"o ângulo tem {len(a)} caracteres; não dá para "
                              f"sustentar uma tese em menos de 40"))
    if _normal(a) == _normal(p.titulo) or _normal(p.titulo) in _normal(a) and len(a) < 80:
        achados.append(Achado("erro", "ângulo", "pauta",
                              "o ângulo repete o título — título nomeia o "
                              "assunto, ângulo afirma o que o episódio diz sobre ele"))
    if not any(m in a.lower() for m in MARCAS_DE_TESE):
        achados.append(Achado("aviso", "ângulo", "pauta",
                              "não achei contraste nem causa no ângulo ('só', "
                              "'não', 'mas', 'em vez de', 'porque'). Pode ser "
                              "tese mesmo assim, mas confira se não é tema disfarçado"))
    return achados


# ── regra 2: fala corrida ────────────────────────────────────────────────────


def _linhas_da_legenda(texto: str) -> int:
    """Quantas linhas a legenda ocupa NA TELA, medido com a fonte real.

    Estimar por contagem de caracteres erraria: a fonte é proporcional e o
    texto vai em maiúsculas. Isto chama o mesmo `quebrar` que desenha o quadro.
    """
    mn = carregar("montar_neuroart")
    return len(mn.quebrar(texto.upper(), mn.fonte(54), mn.SEGURO_LARGURA))


def regra_fala(p: Pauta) -> list[Achado]:
    achados = []
    mn = carregar("montar_neuroart")

    fechadas = total_cortes = 0
    for i, b in enumerate(p.blocos, start=1):
        onde = f"bloco {i}"

        for j, corte in enumerate(b.cortes, start=1):
            if not corte:
                achados.append(Achado("erro", "fala", f"{onde}, corte {j}",
                                      "corte vazio — duas barras seguidas? "
                                      f"Para plano sem legenda, escreva `{SILENCIO}`"))
                continue
            if corte == SILENCIO:
                continue
            total_cortes += 1

            linhas = _linhas_da_legenda(corte)
            if linhas > LINHAS_MAXIMAS:
                achados.append(Achado("erro", "fala", f"{onde}, corte {j}",
                                      f"a legenda ocupa {linhas} linhas na tela "
                                      f"(máximo {LINHAS_MAXIMAS}); corte em dois: "
                                      f"“{corte[:52]}…”"))
            if corte[-1] in ".!?;":
                fechadas += 1
                achados.append(Achado("aviso", "fala", f"{onde}, corte {j}",
                                      f"legenda termina em “{corte[-1]}” — o corte "
                                      f"é no meio da respiração, não no fim da frase"))
            elif corte[:1].isupper() and j > 1:
                fechadas += 1

        segundos = mn.silabas(b.corrido) / p.ritmo_fala
        if segundos > SEGUNDOS_MAXIMOS:
            achados.append(Achado("aviso", "fala", onde,
                                  f"{segundos:.0f}s de fala num bloco só — "
                                  f"respiração longa para gravar de uma vez"))
        if segundos < SEGUNDOS_MINIMOS:
            achados.append(Achado("aviso", "fala", onde,
                                  f"{segundos:.1f}s de fala — bloco tão curto "
                                  f"soa entrecortado na gravação"))

    if total_cortes and fechadas / total_cortes > 0.4:
        achados.append(Achado(
            "aviso", "fala", "pauta",
            f"{fechadas} de {total_cortes} legendas parecem frase fechada. Foi "
            f"assim que o roteiro do episódio 1 ficou impossível de gravar: "
            f"escreva a respiração corrida e marque onde ela CORTA"))

    emendados = sum(1 for b in p.blocos[1:] if _RE_CONECTIVO.match(b.corrido))
    if len(p.blocos) > 2 and emendados / (len(p.blocos) - 1) < 1 / 3:
        achados.append(Achado(
            "aviso", "fala", "pauta",
            f"só {emendados} de {len(p.blocos) - 1} blocos emendam no anterior "
            f"(começam com 'e', 'mas', 'então', 'por isso'…). Cada bloco "
            f"começando do zero é leitura de tópicos, não fala"))
    return achados


# ── regra 3: tempo verbal de afirmação de produto ────────────────────────────


def _frases(texto: str) -> list[str]:
    return [f.strip() for f in re.split(r"(?<=[.!?])\s+", texto) if f.strip()]


def regra_produto(p: Pauta) -> list[Achado]:
    achados = []
    for i, b in enumerate(p.blocos, start=1):
        baixo = b.corrido.lower()
        for termo in p.roadmap:
            if termo.lower() not in baixo:
                continue
            if not any(m in baixo for m in MARCAS_DE_ROADMAP):
                achados.append(Achado(
                    "erro", "produto", f"bloco {i}",
                    f"“{termo}” está declarado como roadmap, mas a fala o "
                    f"apresenta sem marcar que ainda não existe. Diga 'ainda "
                    f"não existe', 'é o próximo passo' — ou mova para entregue"))
        for termo in p.entregue:
            if termo.lower() not in baixo:
                continue
            for frase in _frases(b.corrido):
                if termo.lower() in frase.lower() and any(
                        m in frase.lower() for m in MARCAS_DE_FUTURO):
                    achados.append(Achado(
                        "aviso", "produto", f"bloco {i}",
                        f"“{termo}” já está entregue, mas a frase fala dele no "
                        f"futuro: “{frase[:60]}…”"))
                    break
    return achados


# ── regra 4: fonte para afirmação numérica ───────────────────────────────────


def quantidades(texto: str) -> list[str]:
    """Os números que a fala afirma — em dígito ou escritos."""
    achados = [m.group(0) for m in _RE_NUMERAL.finditer(texto)]
    achados += re.findall(r"\d[\d.,]*\s*%?", texto)
    if _RE_PERCENTUAL.search(texto) and not achados:
        achados.append("por cento")
    # Preserva ordem e tira repetição.
    vistos, saida = set(), []
    for a in achados:
        chave = a.strip().lower()
        if chave not in vistos:
            vistos.add(chave)
            saida.append(a.strip())
    return saida


def regra_fontes(p: Pauta) -> list[Achado]:
    achados = []
    for i, b in enumerate(p.blocos, start=1):
        onde = f"bloco {i}"
        nums = quantidades(b.corrido)
        if b.fonte and b.fonte not in p.fontes:
            achados.append(Achado("erro", "fonte", onde,
                                  f"fonte “{b.fonte}” não está declarada em `fontes`"))
        if nums and not b.fonte:
            achados.append(Achado(
                "erro", "fonte", onde,
                f"afirma {', '.join(repr(n) for n in nums[:4])} sem `fonte`. "
                f"Se o número é do próprio projeto, use `fonte: produto`"))
        # NÃO existe regra inversa ("declarou fonte e não tem número").
        # Afirmação qualitativa também merece fonte — "é o pilar com a
        # evidência mais forte" é verificável e não tem número nenhum. Cobrar
        # o contrário treinaria o autor a ignorar aviso, que é pior que não ter.

    for apelido, f in p.fontes.items():
        if not f.propria and not f.url:
            achados.append(Achado("aviso", "fonte", f"fontes.{apelido}",
                                  "sem url — daqui a três meses ninguém "
                                  "reencontra o estudo para conferir"))
        if not f.titulo:
            achados.append(Achado("erro", "fonte", f"fontes.{apelido}",
                                  "sem título"))
    usadas = {b.fonte for b in p.blocos if b.fonte}
    for apelido in p.fontes:
        if apelido not in usadas:
            achados.append(Achado("aviso", "fonte", f"fontes.{apelido}",
                                  "declarada e não usada por nenhum bloco"))
    return achados


# ── a verificação inteira ────────────────────────────────────────────────────

REGRAS = (regra_angulo, regra_fala, regra_produto, regra_fontes)


def conferir(p: Pauta) -> list[Achado]:
    achados: list[Achado] = []
    for regra in REGRAS:
        achados += regra(p)
    return achados


def erros(achados: list[Achado]) -> list[Achado]:
    return [a for a in achados if a.grau == "erro"]


def relatar(p: Pauta, achados: list[Achado], saida=print) -> None:
    for a in achados:
        saida(str(a))
    n_erros = len(erros(achados))
    n_avisos = len(achados) - n_erros
    if not achados:
        saida("passou nas quatro regras, sem avisos")
    else:
        saida(f"\n{n_erros} erro(s), {n_avisos} aviso(s)")
