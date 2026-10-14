#!/usr/bin/env python3
"""
A pauta de um episódio como ARQUIVO DE DADOS.

POR QUE ISSO EXISTE: os dois episódios publicados são dois scripts Python de
~300 linhas cada, dos quais ~60 são o conteúdo e o resto é a mesma montagem
copiada. Fazer o terceiro episódio significava copiar o segundo e editar no
meio do código de render — que é exatamente onde erro passa despercebido.

Aqui o episódio é um YAML: ângulo, fontes, o que o produto entrega, e os
blocos de fala com os cortes de legenda marcados. O montador é um só.

A ESTRUTURA DE UM BLOCO, e por que ela é assim:

    - fonte: meta-analise
      fala: >
        Testaram vários tipos de exercício em crianças autistas /
        medindo controle inibitório /
        Dezoito estudos, quase quinhentas crianças
      visuais:
        - "placa:META-ANÁLISE|18 estudos|exercício e controle inibitório"
        - "placa:PARTICIPANTES|499 crianças|8 ensaios randomizados"
        - "floresta#0-0.25"

A `fala` é UMA RESPIRAÇÃO, escrita corrida, do jeito que se lê em voz alta. As
barras marcam onde a legenda corta — não onde a frase termina. Essa ordem é o
contrário da que eu usei na primeira versão do episódio 1, e o usuário não
conseguiu gravar: "as frases estão muito duras, não conectam, não fica
natural". Estava certo. Eu havia escrito o texto na medida da legenda, e
ninguém fala em sentenças isoladas; fala emendando.

Um corte sem legenda (a ilustração que entra só para respirar) é escrito
como um `-` sozinho entre barras.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

# Segmento que vale "plano sem legenda": a imagem entra para ser vista, não
# para acompanhar texto.
SILENCIO = "-"


@dataclass
class Fonte:
    """De onde vem uma afirmação. `onde` descreve o desenho do estudo."""

    apelido: str
    titulo: str
    onde: str = ""
    url: str = ""

    @property
    def propria(self) -> bool:
        """Fonte do próprio projeto — não é literatura, é dado de casa."""
        return self.apelido == "produto"


@dataclass
class ObraRef:
    chave: str
    arquivo: str
    titulo: str
    etiqueta: str = ""
    fracoes: int = 0
    valor: int = 0


@dataclass
class Bloco:
    """Uma respiração: a fala corrida, seus cortes de legenda e os visuais."""

    fala: str
    visuais: list[str]
    fonte: str | None = None

    @property
    def cortes(self) -> list[str]:
        """A fala repartida nos pedaços que viram legenda."""
        return [p.strip() for p in self.fala.split("/")]

    @property
    def legendas(self) -> list[str]:
        """Como os cortes vão para a tela: o silêncio vira texto vazio."""
        return ["" if c == SILENCIO else c for c in self.cortes]

    @property
    def corrido(self) -> str:
        """A fala como ela é LIDA: sem as marcas de corte."""
        falado = [c for c in self.cortes if c != SILENCIO]
        return re.sub(r"\s+", " ", " ".join(falado)).strip()


@dataclass
class Pauta:
    arquivo: Path
    titulo: str
    angulo: str
    blocos: list[Bloco]
    fontes: dict[str, Fonte] = field(default_factory=dict)
    entregue: list[str] = field(default_factory=list)
    roadmap: list[str] = field(default_factory=list)
    obras: dict[str, ObraRef] = field(default_factory=dict)
    grafico: dict[str, Any] = field(default_factory=dict)
    fecho: str = ""
    # Título, descrição e link da publicação. Mora na própria pauta: um
    # episódio é um arquivo só, e assim o que foi ao ar fica junto do que foi
    # dito. Preenchido pelo dashboard.
    publicacao: dict[str, Any] = field(default_factory=dict)
    # Mistura aprovada de ouvido em 07/10/2026; fica na pauta para cada
    # episódio poder divergir sem mexer em código.
    volume_trilha: float = 0.75
    ducking: float = 3.5
    ritmo_fala: float = 5.4
    ritmo_leitura: float = 4.3

    @property
    def corrido(self) -> str:
        """O roteiro inteiro, pronto para gravar: um parágrafo por bloco."""
        return "\n\n".join(b.corrido for b in self.blocos)


class PautaInvalida(Exception):
    """Defeito de ESTRUTURA — falta campo, contagem não fecha. Distinto do
    linter, que julga o conteúdo de uma pauta bem formada."""


def _texto(bruto: dict, chave: str, onde: str) -> str:
    valor = bruto.get(chave)
    if not isinstance(valor, str) or not valor.strip():
        raise PautaInvalida(f"{onde}: falta `{chave}`")
    return re.sub(r"\s+", " ", valor).strip()


def carregar(arquivo: Path) -> Pauta:
    bruto = yaml.safe_load(arquivo.read_text(encoding="utf-8"))
    if not isinstance(bruto, dict):
        raise PautaInvalida(f"{arquivo}: o arquivo não é um mapa YAML")

    fontes = {}
    for apelido, d in (bruto.get("fontes") or {}).items():
        if isinstance(d, str):
            d = {"titulo": d}
        fontes[apelido] = Fonte(apelido, d.get("titulo", ""),
                                d.get("onde", ""), d.get("url", ""))

    obras = {}
    for chave, d in (bruto.get("obras") or {}).items():
        if isinstance(d, str):
            d = {"arquivo": d}
        obras[chave] = ObraRef(chave, d.get("arquivo", chave),
                               d.get("titulo", chave), d.get("etiqueta", ""),
                               int(d.get("fracoes", 0)), int(d.get("valor", 0)))

    crus = bruto.get("blocos")
    if not isinstance(crus, list) or not crus:
        raise PautaInvalida(f"{arquivo}: `blocos` vazio ou ausente")

    blocos = []
    for i, d in enumerate(crus, start=1):
        onde = f"bloco {i}"
        if not isinstance(d, dict):
            raise PautaInvalida(f"{onde}: esperava um mapa com `fala` e `visuais`")
        fala = _texto(d, "fala", onde)
        visuais = d.get("visuais")
        if not isinstance(visuais, list) or not all(isinstance(v, str) for v in visuais):
            raise PautaInvalida(f"{onde}: `visuais` tem que ser uma lista de textos")
        bloco = Bloco(fala, visuais, d.get("fonte"))
        # A contagem é invariante do formato, não julgamento de conteúdo: um
        # visual por corte de legenda, na ordem. Sem isso o montador casaria
        # legenda com a imagem errada, calado.
        if len(bloco.cortes) != len(visuais):
            raise PautaInvalida(
                f"{onde}: {len(bloco.cortes)} cortes de fala e {len(visuais)} "
                f"visuais — tem que ser um visual por corte\n"
                f"  cortes: {bloco.cortes}")
        blocos.append(bloco)

    produto = bruto.get("produto") or {}
    return Pauta(
        arquivo=arquivo,
        titulo=_texto(bruto, "titulo", str(arquivo)),
        # `angulo` ausente é erro de ESTRUTURA, não aviso: é o campo que
        # distingue uma pauta de uma lista de assuntos.
        angulo=_texto(bruto, "angulo", str(arquivo)),
        blocos=blocos,
        fontes=fontes,
        entregue=[str(x) for x in (produto.get("entregue") or [])],
        roadmap=[str(x) for x in (produto.get("roadmap") or [])],
        obras=obras,
        grafico=bruto.get("grafico") or {},
        fecho=str(bruto.get("fecho") or ""),
        publicacao=bruto.get("publicacao") or {},
        volume_trilha=float(bruto.get("volume_trilha", 0.75)),
        ducking=float(bruto.get("ducking", 3.5)),
        ritmo_fala=float(bruto.get("ritmo_fala", 5.4)),
        ritmo_leitura=float(bruto.get("ritmo_leitura", 4.3)),
    )
