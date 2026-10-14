#!/usr/bin/env python3
"""
Cada regra é testada contra O ERRO REAL que ela existe para pegar.

Linter que aprova tudo não vale nada, e o único jeito de saber se ele pega
alguma coisa é mostrar a ele o texto que passou na operação de verdade e
custou trabalho. Os quatro casos abaixo aconteceram:

  1. o episódio 2 nasceu como "os quatro pilares científicos" — uma lista;
  2. a primeira versão do episódio 1 eram onze sentenças fechadas, e a
     gravação travou;
  3. eu escrevi a interface cérebro-computador como pilar existente;
  4. "dezoito estudos, quase quinhentas crianças" esteve no roteiro antes de
     existir qualquer fonte declarada.

    python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from niche import linter  # noqa: E402
from niche.pauta import PautaInvalida, carregar  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
PAUTAS = RAIZ / "pautas"
# Nomeados, não `glob`: a pasta recebe rascunhos novos o tempo todo, e um
# rascunho recém-criado reprova de propósito. O que tem que continuar passando
# são os dois episódios que foram ao ar.
PUBLICADAS = ("01-arte-tokenizada.yml", "02-pilares-cientificos.yml")

BASE = """
titulo: Teste
angulo: >
  Só uma das quatro modalidades tem meta-análise por trás, e o episódio diz
  qual em vez de listar as quatro com o mesmo peso.
fontes:
  produto: {titulo: NeuroArt DApp, url: "https://exemplo"}
produto:
  entregue: [tokenização]
  roadmap: ["interface cérebro-computador"]
blocos:
"""


def pauta_de(corpo: str, cabeca: str = BASE):
    arq = Path(tempfile.mkstemp(suffix=".yml")[1])
    arq.write_text(cabeca + corpo, encoding="utf-8")
    return carregar(arq)


def graus(achados, regra):
    return [a for a in achados if a.regra == regra]


class Regra1Angulo(unittest.TestCase):
    def test_tema_disfarcado_de_angulo_recebe_aviso(self):
        """"Os quatro pilares científicos do NeuroArt" é lista, não tese."""
        p = pauta_de(
            "  - fala: Um teste qualquer de fala corrida aqui\n"
            "    visuais: [fecho]\n",
            BASE.replace(
                "angulo: >\n  Só uma das quatro modalidades tem meta-análise por "
                "trás, e o episódio diz\n  qual em vez de listar as quatro com o "
                "mesmo peso.",
                "angulo: Os quatro pilares científicos do projeto NeuroArt DApp"),
        )
        avisos = graus(linter.regra_angulo(p), "ângulo")
        self.assertTrue(avisos, "um ângulo sem contraste nem causa tem que avisar")

    def test_angulo_ausente_nao_carrega(self):
        with self.assertRaises(PautaInvalida):
            pauta_de("  - fala: qualquer coisa\n    visuais: [fecho]\n",
                     "titulo: Teste\nblocos:\n")

    def test_angulo_curto_e_erro(self):
        p = pauta_de("  - fala: qualquer coisa de fala\n    visuais: [fecho]\n",
                     "titulo: Teste\nangulo: sobre arte e ciência\nblocos:\n")
        self.assertTrue(linter.erros(linter.regra_angulo(p)))

    def test_o_angulo_real_do_episodio_2_passa(self):
        p = carregar(PAUTAS / "02-pilares-cientificos.yml")
        self.assertEqual([], linter.erros(linter.regra_angulo(p)))


class Regra2Fala(unittest.TestCase):
    def test_onze_sentencas_fechadas_sao_pegas(self):
        """
        O roteiro que o usuário não conseguiu gravar. Cada legenda era uma
        frase completa, com ponto final e começando em maiúscula.
        """
        duras = [
            "Esse quadro está na blockchain.",
            "Ele foi dividido em cem pedaços.",
            "Cada pedaço custa cento e noventa e oito reais.",
            "O artista escolheu em quantas partes dividir.",
            "Quem compra leva fração de uma tela real.",
            "A obra existe pendurada numa parede.",
        ]
        corpo = ""
        for frase in duras:
            corpo += (f"  - fonte: produto\n    fala: {frase}\n"
                      f"    visuais: [fecho]\n")
        achados = linter.regra_fala(pauta_de(corpo))
        texto = " ".join(a.texto for a in achados)
        self.assertIn("frase fechada", texto)
        self.assertGreaterEqual(
            sum(1 for a in achados if "termina em" in a.texto), 5,
            "cada legenda terminando em ponto tem que ser apontada")

    def test_blocos_que_nao_emendam_recebem_aviso(self):
        corpo = ""
        for frase in ["Primeiro assunto sem nenhuma ligação com o resto",
                      "Segundo assunto também solto no meio do episódio",
                      "Terceiro assunto igualmente desligado dos outros",
                      "Quarto assunto fechando a lista de tópicos soltos"]:
            corpo += f"  - fala: {frase}\n    visuais: [fecho]\n"
        texto = " ".join(a.texto for a in linter.regra_fala(pauta_de(corpo)))
        self.assertIn("emendam", texto)

    def test_legenda_que_vira_parede_de_texto_e_erro(self):
        longa = ("Essa obra foi tokenizada na blockchain da Base e dividida em "
                 "cem frações distintas que qualquer pessoa pode comprar hoje "
                 "mesmo pelo marketplace do projeto sem intermediário nenhum")
        p = pauta_de(f"  - fala: {longa}\n    visuais: [fecho]\n")
        erros = linter.erros(linter.regra_fala(p))
        self.assertTrue(erros)
        self.assertIn("linhas na tela", erros[0].texto)

    def test_corte_vazio_e_erro(self):
        p = pauta_de("  - fala: Uma coisa // outra coisa qualquer\n"
                     "    visuais: [fecho, fecho, fecho]\n")
        self.assertTrue(any("corte vazio" in a.texto
                            for a in linter.erros(linter.regra_fala(p))))

    def test_os_dois_episodios_publicados_passam(self):
        for nome in PUBLICADAS:
            with self.subTest(pauta=nome):
                self.assertEqual(
                    [], linter.erros(linter.regra_fala(carregar(PAUTAS / nome))))


class Regra3Produto(unittest.TestCase):
    def test_bci_como_pilar_existente_e_erro(self):
        """Exatamente o que eu escrevi e o usuário corrigiu com "BCI é roadmap"."""
        p = pauta_de(
            "  - fala: >\n"
            "      O quarto pilar é a interface cérebro-computador /\n"
            "      que registra os estados de foco do artista\n"
            "    visuais: [fecho, fecho]\n")
        erros = linter.erros(linter.regra_produto(p))
        self.assertTrue(erros)
        self.assertIn("roadmap", erros[0].texto)

    def test_bci_marcado_como_roadmap_passa(self):
        p = pauta_de(
            "  - fala: >\n"
            "      e a interface cérebro-computador /\n"
            "      que ainda não existe. É o próximo passo\n"
            "    visuais: [fecho, fecho]\n")
        self.assertEqual([], linter.erros(linter.regra_produto(p)))

    def test_entrega_escrita_no_futuro_recebe_aviso(self):
        p = pauta_de("  - fala: A tokenização vai ser feita na rede Base\n"
                     "    visuais: [fecho]\n")
        self.assertTrue(linter.regra_produto(p))

    def test_vai_no_sentido_de_presente_nao_dispara(self):
        """"oitenta por cento vai para o artista" é presente, não futuro."""
        p = pauta_de("  - fonte: produto\n"
                     "    fala: Na tokenização, oitenta por cento vai para o artista\n"
                     "    visuais: [divisao]\n")
        self.assertEqual([], linter.regra_produto(p))


class Regra4Fontes(unittest.TestCase):
    def test_numero_escrito_sem_fonte_e_erro(self):
        p = pauta_de("  - fala: Dezoito estudos, quase quinhentas crianças\n"
                     "    visuais: [fecho]\n")
        erros = linter.erros(linter.regra_fontes(p))
        self.assertTrue(erros)
        self.assertIn("dezoito", erros[0].texto.lower())

    def test_digito_sem_fonte_e_erro(self):
        p = pauta_de("  - fala: São 499 crianças em 8 ensaios randomizados\n"
                     "    visuais: [fecho]\n")
        self.assertTrue(linter.erros(linter.regra_fontes(p)))

    def test_percentual_sem_fonte_e_erro(self):
        p = pauta_de("  - fala: Oitenta por cento da venda vai para o artista\n"
                     "    visuais: [fecho]\n")
        self.assertTrue(linter.erros(linter.regra_fontes(p)))

    def test_artigo_um_nao_conta_como_numero(self):
        """"um pedaço", "uma tela" são artigo. Contar isso marcaria toda fala."""
        p = pauta_de("  - fala: Quem compra um pedaço leva fração de uma tela\n"
                     "    visuais: [fecho]\n")
        self.assertEqual([], linter.erros(linter.regra_fontes(p)))

    def test_fonte_nao_declarada_e_erro(self):
        p = pauta_de("  - fonte: inexistente\n"
                     "    fala: Dezoito estudos com quinhentas crianças\n"
                     "    visuais: [fecho]\n")
        self.assertTrue(any("não está declarada" in a.texto
                            for a in linter.erros(linter.regra_fontes(p))))

    def test_fonte_produto_satisfaz_numero_do_projeto(self):
        p = pauta_de("  - fonte: produto\n"
                     "    fala: Foi dividido em cem pedaços de cento e noventa e oito reais\n"
                     "    visuais: [fecho]\n")
        self.assertEqual([], linter.erros(linter.regra_fontes(p)))


class RegraEsqueleto(unittest.TestCase):
    def test_pauta_recem_criada_reprova(self):
        """
        O esqueleto tem que REPROVAR. Sem isto ele passaria: o texto-lembrete
        do ângulo tem mais de 40 caracteres e não repete o título, que é tudo
        o que a regra do ângulo mede sozinha — e um rascunho aprovado ensina a
        preencher placeholder em vez de mostrar qual é o padrão.
        """
        import tempfile as _tf
        from niche import modelo
        pasta = Path(_tf.mkdtemp())
        arq = modelo.criar(pasta, "Episódio de teste")
        erros = linter.erros(linter.conferir(carregar(arq)))
        self.assertTrue(erros)
        self.assertTrue(all(e.regra == "esqueleto" for e in erros), erros)

    def test_titulo_vira_nome_de_arquivo_sem_acento(self):
        from niche import modelo
        self.assertEqual("a obra tokenizada".replace(" ", "-"),
                         modelo.apelidar("A Obra Tokenizada"))
        self.assertEqual("pilares-cientificos", modelo.apelidar("Pilares Científicos"))


class Estrutura(unittest.TestCase):
    def test_contagem_de_visuais_tem_que_bater_com_os_cortes(self):
        with self.assertRaises(PautaInvalida) as c:
            pauta_de("  - fala: um corte / outro corte / terceiro corte\n"
                     "    visuais: [fecho, fecho]\n")
        self.assertIn("um visual por corte", str(c.exception))

    def test_fala_corrida_nao_tem_as_barras(self):
        p = pauta_de("  - fala: primeiro pedaço / segundo pedaço / -\n"
                     "    visuais: [fecho, fecho, fecho]\n")
        self.assertEqual("primeiro pedaço segundo pedaço", p.blocos[0].corrido)
        self.assertEqual(["primeiro pedaço", "segundo pedaço", ""],
                         p.blocos[0].legendas)

    def test_os_dois_episodios_publicados_passam_inteiros(self):
        for nome in PUBLICADAS:
            with self.subTest(pauta=nome):
                p = carregar(PAUTAS / nome)
                self.assertEqual([], linter.erros(linter.conferir(p)))


if __name__ == "__main__":
    unittest.main()
