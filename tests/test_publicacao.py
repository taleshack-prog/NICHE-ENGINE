#!/usr/bin/env python3
"""
A escrita do bloco `publicacao:` mexe nos arquivos que o usuário escreveu.

É a única parte do sistema que EDITA uma pauta existente, e as pautas são meio
comentário — é lá que está escrito por que a ordem dos pilares mudou e por que
a placa de roadmap é apagada. Um carregar-e-despejar de YAML devolveria o
arquivo funcionando e ilegível, e ninguém perceberia até precisar do
comentário. Por isso estes testes olham para o TEXTO, não só para os dados.

    python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import yaml  # noqa: E402

from niche import publicacao  # noqa: E402

ORIGINAL = """\
# Comentário de topo que explica a peça inteira.
titulo: Teste

angulo: >
  Uma tese qualquer que só existe para o arquivo carregar sem reclamar.

blocos:
  # Por que este bloco tem 15 segundos.
  - fala: uma coisa / outra coisa
    visuais:
      - fecho
      - fecho
"""


class Gravacao(unittest.TestCase):
    def setUp(self):
        self.arq = Path(tempfile.mkdtemp()) / "p.yml"
        self.arq.write_text(ORIGINAL, encoding="utf-8")

    def test_preserva_comentarios_e_formatacao(self):
        publicacao.gravar(self.arq, {"titulo": "No ar", "url": "https://y/1"})
        texto = self.arq.read_text(encoding="utf-8")
        self.assertIn("# Comentário de topo que explica a peça inteira.", texto)
        self.assertIn("# Por que este bloco tem 15 segundos.", texto)
        self.assertIn("angulo: >", texto)

    def test_grava_os_campos(self):
        publicacao.gravar(self.arq, {
            "titulo": "No ar", "descricao": "duas\nlinhas",
            "hashtags": ["#a", "#b"], "url": "https://y/1",
        })
        d = yaml.safe_load(self.arq.read_text(encoding="utf-8"))["publicacao"]
        self.assertEqual("No ar", d["titulo"])
        self.assertEqual("duas\nlinhas", d["descricao"])
        self.assertEqual(["#a", "#b"], d["hashtags"])

    def test_regravar_substitui_em_vez_de_acumular(self):
        publicacao.gravar(self.arq, {"titulo": "primeiro", "url": "https://y/1"})
        publicacao.gravar(self.arq, {"titulo": "segundo", "url": "https://y/2"})
        texto = self.arq.read_text(encoding="utf-8")
        self.assertEqual(1, texto.count("publicacao:"))
        self.assertNotIn("primeiro", texto)

    def test_descricao_de_varias_linhas_fica_legivel_e_volta_igual(self):
        """
        A descrição é o campo que a pessoa relê e copia para o YouTube. No
        estilo com aspas o PyYAML dobra a linha longa e vira sopa; em bloco
        literal ela fica como foi escrita — e tem que voltar idêntica.
        """
        texto = ("Meta-análise de 18 estudos.\n\nFontes:\n"
                 "• Exercise intervention and inhibitory control in children and "
                 "adolescents with autism — https://pubmed.ncbi.nlm.nih.gov/\n"
                 "• Judo training and working memory in children with ADHD — "
                 "https://pubmed.ncbi.nlm.nih.gov/")
        publicacao.gravar(self.arq, {"titulo": "x", "descricao": texto})
        bruto = self.arq.read_text(encoding="utf-8")
        self.assertIn("descricao: |", bruto)
        self.assertEqual(
            texto, yaml.safe_load(bruto)["publicacao"]["descricao"].rstrip("\n"))

    def test_campo_vazio_sai_do_arquivo(self):
        """Apagar o campo na tela tem que apagá-lo na pauta, não gravar ''."""
        publicacao.gravar(self.arq, {"titulo": "x", "descricao": "some depois"})
        publicacao.gravar(self.arq, {"titulo": "x", "descricao": ""})
        d = yaml.safe_load(self.arq.read_text(encoding="utf-8"))["publicacao"]
        self.assertNotIn("descricao", d)

    def test_bloco_no_meio_do_arquivo_nao_engole_o_resto(self):
        """O bloco delimita pela próxima chave de coluna zero, não pelo fim."""
        meio = ORIGINAL.replace(
            "blocos:", "publicacao:\n  titulo: antigo\n  url: https://y/0\n\nblocos:")
        self.arq.write_text(meio, encoding="utf-8")
        publicacao.gravar(self.arq, {"titulo": "novo", "url": "https://y/9"})
        d = yaml.safe_load(self.arq.read_text(encoding="utf-8"))
        self.assertEqual("novo", d["publicacao"]["titulo"])
        self.assertEqual(1, len(d["blocos"]), "o bloco de fala sumiu")
        self.assertIn("# Por que este bloco tem 15 segundos.",
                      self.arq.read_text(encoding="utf-8"))

    def test_resultado_invalido_nao_chega_ao_disco(self):
        """Arquivo corrompido por edição cirúrgica é pior que edição recusada."""
        self.arq.write_text("titulo: Teste\nblocos: [\n", encoding="utf-8")
        antes = self.arq.read_text(encoding="utf-8")
        with self.assertRaises(yaml.YAMLError):
            publicacao.gravar(self.arq, {"titulo": "x"})
        self.assertEqual(antes, self.arq.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
