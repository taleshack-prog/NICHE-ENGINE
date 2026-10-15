#!/usr/bin/env python3
"""
Onde moram pautas, obras, ilustrações e vídeos.

Na sua máquina é tudo dentro do repositório, como sempre foi. No serviço do
Railway é um volume montado em /dados — o contêiner é descartável e o disco
dele some a cada deploy, então nada que importe pode ficar na imagem.

Cada caminho é sobrescrevível por variável de ambiente. Nenhum código fora
daqui deve montar esses caminhos à mão: foi assim que `pautas/` acabou escrito
em três arquivos diferentes.
"""

from __future__ import annotations

import os
from pathlib import Path

from .proveniencia import RAIZ

_RAIZ_DADOS = os.environ.get("NICHE_DADOS")
BASE = Path(_RAIZ_DADOS) if _RAIZ_DADOS else RAIZ


def _pasta(variavel: str, padrao: str) -> Path:
    bruto = os.environ.get(variavel)
    return Path(bruto) if bruto else BASE / padrao


PAUTAS = _pasta("NICHE_PAUTAS", "pautas")
RENDERS = _pasta("NICHE_RENDERS", "renders")
OBRAS = _pasta("NICHE_OBRAS", "acervo/obras")
ILUSTRA = _pasta("NICHE_ILUSTRA", "acervo/ilustra")
TRABALHOS = _pasta("NICHE_TRABALHOS", ".niche-jobs")


def garantir() -> None:
    """Cria as pastas que o serviço escreve. Idempotente."""
    for p in (PAUTAS, RENDERS, OBRAS, ILUSTRA, TRABALHOS):
        p.mkdir(parents=True, exist_ok=True)
