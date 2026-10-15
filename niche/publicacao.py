#!/usr/bin/env python3
"""
Grava o bloco `publicacao:` na pauta SEM reescrever o resto do arquivo.

POR QUE NÃO `yaml.safe_load` + `yaml.dump`: as pautas são meio comentário. O
comentário é onde está escrito por que a ordem dos pilares mudou, por que a
placa de roadmap é apagada, por que aquele bloco tem 15 segundos. Um
carregar-e-despejar apaga tudo isso, reordena as chaves e normaliza as aspas —
o arquivo volta funcionando e ilegível.

Então a escrita é cirúrgica: acha o bloco de topo `publicacao:`, troca só ele,
e se não existir acrescenta no fim. O resto do texto não é tocado.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

CAMPOS = ("titulo", "descricao", "hashtags", "url", "publicado_em")


class _Despejador(yaml.SafeDumper):
    """Texto de várias linhas sai em bloco literal (`|-`), não entre aspas.

    A descrição de um vídeo tem quebras de linha e links. No estilo com aspas
    o PyYAML DOBRA a linha longa e representa a quebra real como linha em
    branco: o conteúdo volta certo, mas o arquivo fica ilegível justamente no
    campo que a pessoa vai reler e copiar para o YouTube.
    """


def _texto(despejador, dado):
    estilo = "|" if "\n" in dado else None
    return despejador.represent_scalar("tag:yaml.org,2002:str", dado, style=estilo)


_Despejador.add_representer(str, _texto)


def _bloco(dados: dict[str, Any]) -> str:
    """O YAML do bloco, com os campos na ordem fixa e nada de âncora."""
    limpo = {k: dados[k] for k in CAMPOS if dados.get(k) not in (None, "", [])}
    if not limpo:
        return ""
    corpo = yaml.dump(limpo, Dumper=_Despejador, allow_unicode=True,
                      sort_keys=False, default_flow_style=False, width=10_000)
    return "publicacao:\n" + "".join(
        (f"  {l}\n" if l.strip() else "\n") for l in corpo.rstrip().splitlines())


def _recortar(texto: str) -> tuple[str, str, str]:
    """
    Parte o arquivo em (antes, bloco atual, depois).

    O bloco de topo vai de uma linha que começa em `publicacao:` (coluna zero)
    até a próxima linha que também começa na coluna zero sem ser comentário —
    que é como o YAML delimita um mapa aninhado.
    """
    linhas = texto.splitlines(keepends=True)
    inicio = next((i for i, l in enumerate(linhas)
                   if re.match(r"^publicacao\s*:", l)), None)
    if inicio is None:
        return texto, "", ""
    fim = len(linhas)
    for j in range(inicio + 1, len(linhas)):
        l = linhas[j]
        if l.strip() and not l[0].isspace() and not l.lstrip().startswith("#"):
            fim = j
            break
    return "".join(linhas[:inicio]), "".join(linhas[inicio:fim]), "".join(linhas[fim:])


def gravar(arquivo: Path, dados: dict[str, Any]) -> str:
    """Escreve o bloco e devolve o texto novo do arquivo."""
    texto = arquivo.read_text(encoding="utf-8")
    antes, _atual, depois = _recortar(texto)
    bloco = _bloco(dados)

    if not depois and not _atual:
        # Não existia: entra no fim, separado por uma linha em branco.
        novo = texto.rstrip("\n") + ("\n\n" + bloco if bloco else "\n")
    else:
        novo = antes + (bloco + ("\n" if depois and bloco else "")) + depois

    # Confere que o resultado ainda é YAML válido ANTES de tocar no disco:
    # arquivo corrompido por edição cirúrgica é pior que edição recusada.
    yaml.safe_load(novo)
    arquivo.write_text(novo, encoding="utf-8")
    return novo
