#!/usr/bin/env python3
"""
O esqueleto de uma pauta nova.

Mora aqui, e não dentro do dashboard, porque criar episódio pelo terminal e
criar pelo navegador têm que produzir o MESMO arquivo. Duas versões do modelo
divergem na primeira vez que alguém melhorar uma delas.

O esqueleto nasce de propósito reprovado pelo linter: o ângulo é um lembrete
do que escrever, não uma tese. Rascunho que já passa nas regras ensina a
preencher placeholder; rascunho que reprova mostra, no primeiro salvamento,
qual é o padrão.
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path

MODELO = """\
# {titulo}
# Criada em {hoje}.

titulo: {titulo}

# O ÂNGULO É A TESE: o que este episódio AFIRMA, não o assunto de que trata.
# "Os quatro pilares do projeto" é tema. "Dos quatro, só um tem meta-análise
# por trás" é ângulo — e muda a ordem em que as coisas são ditas.
angulo: >
  ESCREVA AQUI o que o episódio afirma, em uma ou duas frases.

# Toda afirmação numérica precisa citar uma destas pelo apelido.
# `produto` é reservado para dado do próprio projeto.
fontes:
  produto:
    titulo: NeuroArt DApp
    onde: dados do próprio projeto
    url: https://neuro-art-d-app.vercel.app/

produto:
  entregue: []          # o que o projeto JÁ faz
  roadmap: []           # o que ainda não existe — a fala tem que marcar isso

# As obras que este episódio usa. Remova se não usar nenhuma.
obras:
  kanji: {{arquivo: white-kanji, titulo: White Kanji, etiqueta: Estado de Fluxo, fracoes: 100, valor: 19800}}

blocos:
  # Cada bloco é UMA RESPIRAÇÃO, escrita corrida, do jeito que se lê em voz
  # alta. As barras marcam onde a LEGENDA corta, não onde a frase termina.
  # Um visual por corte, na ordem. Um corte escrito `-` é plano sem legenda.
  - fonte: produto
    fala: >
      primeiro pedaço da fala /
      segundo pedaço, emendando no anterior
    visuais:
      - placa:CHAPÉU|Destaque|linha de apoio
      - detalhe:kanji,0.4

  - fala: NeuroArt DApp — unindo a arte à ciência
    visuais:
      - fecho
"""


def apelidar(titulo: str) -> str:
    """Título → nome de arquivo: minúsculo, sem acento, hífen no lugar do resto."""
    import unicodedata

    sem_acento = "".join(
        c for c in unicodedata.normalize("NFD", titulo)
        if unicodedata.category(c) != "Mn"
    )
    slug = re.sub(r"[^a-z0-9]+", "-", sem_acento.lower()).strip("-")
    return slug[:60] or "episodio"


def criar(pasta: Path, titulo: str, slug: str | None = None) -> Path:
    slug = slug or apelidar(titulo)
    if not re.fullmatch(r"[\w-]{1,80}", slug):
        raise ValueError(f"nome de arquivo inválido: {slug}")
    destino = pasta / f"{slug}.yml"
    if destino.exists():
        raise FileExistsError(f"já existe: {destino}")
    pasta.mkdir(parents=True, exist_ok=True)
    destino.write_text(
        MODELO.format(titulo=titulo, hoje=date.today().strftime("%d/%m/%Y")),
        encoding="utf-8",
    )
    return destino
