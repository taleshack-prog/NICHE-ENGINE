#!/usr/bin/env python3
"""
A narração: a pontuação que o TTS precisa e os tempos que a legenda precisa.

A chamada à fal é trocada por um gerador de silêncio com duração conhecida —
o que se quer provar aqui não é que a fal responde, é que a soma dos tempos
devolvidos é EXATAMENTE a duração do arquivo montado. Se isso escorregar, a
legenda desliza em relação à voz ao longo do episódio, e esse é o defeito
mais caro de perceber: só aparece no minuto final do vídeo pronto.
"""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

from niche import voz
from niche.pauta import Bloco, Pauta


def _bloco(fala: str) -> Bloco:
    return Bloco(fala=fala, visuais=["placa:X|y|z"] * len(fala.split("/")))


class TestLocucao(unittest.TestCase):
    """A fala é escrita para legenda; a locução precisa de pontuação."""

    def test_corte_seguido_de_maiuscula_vira_ponto(self):
        b = _bloco("Esse quadro está na blockchain / Foi dividido em cem")
        self.assertEqual(
            b.locucao, "Esse quadro está na blockchain. Foi dividido em cem."
        )

    def test_corte_seguido_de_minuscula_vira_virgula(self):
        b = _bloco("Leva fração de uma tela que existe / pendurada numa parede")
        self.assertEqual(
            b.locucao, "Leva fração de uma tela que existe, pendurada numa parede."
        )

    def test_pontuacao_existente_e_respeitada(self):
        b = _bloco("Em outra, mil. / E ninguém reclamou")
        self.assertEqual(b.locucao, "Em outra, mil. E ninguém reclamou.")

    def test_silencio_nao_vira_fala(self):
        b = Bloco(fala="A tela está aqui / - / e custa caro",
                  visuais=["a", "b", "c"])
        self.assertEqual(b.locucao, "A tela está aqui, e custa caro.")

    def test_bloco_so_de_silencio_nao_tem_locucao(self):
        self.assertEqual(Bloco(fala="-", visuais=["a"]).locucao, "")

    def test_legenda_continua_intacta(self):
        """A pontuação é para o TTS; a tela não pode mudar por causa dela."""
        b = _bloco("Esse quadro está na blockchain / Foi dividido em cem")
        self.assertEqual(
            b.legendas, ["Esse quadro está na blockchain", "Foi dividido em cem"]
        )


def _mp3_de(segundos: float, destino: Path) -> bytes:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", f"anullsrc=r=44100:cl=stereo", "-t", f"{segundos:.3f}",
         "-c:a", "libmp3lame", "-b:a", "128k", str(destino)],
        check=True,
    )
    return destino.read_bytes()


class TestNarrar(unittest.TestCase):
    """Montagem do áudio e os tempos — tudo menos a rede."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp(prefix="teste-voz-"))
        self.duracoes = [2.0, 3.0, 1.5]
        self.chamadas = 0
        self.original = voz._sintetizar
        voz._sintetizar = self._falso
        self.chave = voz._chave
        voz._chave = lambda: "chave-de-teste"

    def tearDown(self):
        import shutil
        voz._sintetizar = self.original
        voz._chave = self.chave
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _falso(self, texto: str, voz_nome: str) -> bytes:
        d = self.duracoes[self.chamadas % len(self.duracoes)]
        self.chamadas += 1
        return _mp3_de(d, self.tmp / f"falso-{self.chamadas}.mp3")

    def _pauta(self, falas: list[str]) -> Pauta:
        return Pauta(arquivo=Path("x.yml"), titulo="T", angulo="A",
                     blocos=[_bloco(f) for f in falas])

    def test_tempos_somam_a_duracao_do_arquivo(self):
        p = self._pauta(["Um dois três / quatro cinco",
                         "Seis sete oito / nove dez",
                         "Onze doze / treze"])
        n = voz.narrar(p, "teste", pasta=self.tmp / "vozes")

        medido = voz._ffprobe(n.arquivo)
        self.assertAlmostEqual(sum(n.tempos), medido, delta=0.25)

    def test_cada_bloco_tem_seu_tempo(self):
        p = self._pauta(["Um dois três", "Seis sete oito", "Onze doze"])
        n = voz.narrar(p, "teste", pasta=self.tmp / "vozes")
        self.assertEqual(len(n.tempos), 3)

    def test_entrada_entra_no_primeiro_bloco(self):
        """A entrada é silêncio antes da primeira palavra; sem ela contada no
        bloco 1, a legenda inteira adianta."""
        p = self._pauta(["Um dois três", "Seis sete oito", "Onze doze"])
        n = voz.narrar(p, "teste", pasta=self.tmp / "vozes")
        self.assertAlmostEqual(
            n.tempos[0], voz.ENTRADA + 2.0 + voz.RESPIRO, delta=0.15
        )

    def test_ultimo_bloco_leva_a_saida_e_nao_o_respiro(self):
        p = self._pauta(["Um dois três", "Seis sete oito", "Onze doze"])
        n = voz.narrar(p, "teste", pasta=self.tmp / "vozes")
        self.assertAlmostEqual(n.tempos[-1], 1.5 + voz.SAIDA, delta=0.15)

    def test_segunda_chamada_reaproveita_o_disco(self):
        """Remontar não pode gastar de novo: é dinheiro por visual torto."""
        p = self._pauta(["Um dois três", "Seis sete oito"])
        primeira = voz.narrar(p, "teste", pasta=self.tmp / "vozes")
        gastas = self.chamadas
        segunda = voz.narrar(p, "teste", pasta=self.tmp / "vozes")

        self.assertEqual(self.chamadas, gastas, "gerou de novo o que já existia")
        self.assertEqual(segunda.gerados, 0)
        self.assertEqual(segunda.caracteres, 0)
        self.assertEqual(primeira.tempos, segunda.tempos)

    def test_texto_mudado_gera_de_novo(self):
        p = self._pauta(["Um dois três", "Seis sete oito"])
        voz.narrar(p, "teste", pasta=self.tmp / "vozes")
        gastas = self.chamadas
        outra = self._pauta(["Um dois três", "Seis sete oito e nove"])
        voz.narrar(outra, "teste", pasta=self.tmp / "vozes")
        self.assertEqual(self.chamadas, gastas + 1, "não regerou o bloco alterado")

    def test_sem_chave_recusa_antes_de_tentar(self):
        voz._chave = lambda: ""
        with self.assertRaises(voz.VozIndisponivel):
            voz.narrar(self._pauta(["Um dois"]), "teste", pasta=self.tmp / "v2")

    def test_custo_sai_dos_caracteres_gerados(self):
        p = self._pauta(["Um dois três", "Seis sete oito"])
        n = voz.narrar(p, "teste", pasta=self.tmp / "vozes")
        esperado = n.caracteres / 1000 * 0.08
        self.assertAlmostEqual(n.usd, esperado, places=6)


if __name__ == "__main__":
    unittest.main()
