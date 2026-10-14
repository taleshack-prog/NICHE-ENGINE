#!/usr/bin/env python3
"""
Carrega os módulos de `scripts/` que já produziram os episódios publicados.

POR QUE IMPORTLIB E NÃO IMPORT NORMAL: `scripts/` não é pacote, e os módulos
de lá continuam rodando sozinhos pela linha de comando (`python3
scripts/montar_neuroart.py --obras ...`). Reescrevê-los como pacote quebraria
isso sem necessidade; e eles são o código que funcionou — o automático se
apoia nele em vez de recriá-lo.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

RAIZ = Path(__file__).resolve().parent.parent
SCRIPTS = RAIZ / "scripts"


def carregar(nome: str) -> ModuleType:
    if nome in sys.modules:
        return sys.modules[nome]
    arquivo = SCRIPTS / f"{nome}.py"
    if not arquivo.exists():
        raise FileNotFoundError(f"não achei {arquivo}")
    spec = importlib.util.spec_from_file_location(nome, arquivo)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nome] = mod
    spec.loader.exec_module(mod)
    return mod
