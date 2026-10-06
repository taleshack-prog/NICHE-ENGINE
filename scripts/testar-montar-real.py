#!/usr/bin/env python3
"""Roda montar-real.py com ativos sintéticos: sem rede, só para validar ffmpeg."""
import importlib.util, subprocess, sys, tempfile
from pathlib import Path

RAIZ = Path("/home/claude/niche-engine")
spec = importlib.util.spec_from_file_location("mr", RAIZ / "scripts/montar-real.py")
mr = importlib.util.module_from_spec(spec)
sys.modules["mr"] = mr
sys.argv = ["montar-real.py"]
spec.loader.exec_module(mr)

area = Path(tempfile.mkdtemp(prefix="teste-"))
mr.CACHE = area / "cache"
mr.TRILHA = area / "trilha.m4a"

# narração falsa: 5 blocos com durações parecidas com as reais
DURACOES = [2.2, 2.6, 5.4, 5.0, 2.1]
vozes = []
for i, d in enumerate(DURACOES):
    p = area / f"voz-{i}.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
                    "-i", f"sine=frequency=220:duration={d}", "-ar", "44100", "-ac", "1",
                    str(p)], check=True)
    vozes.append(p)

# trilha falsa, mais curta que o vídeo de propósito: testa o -stream_loop
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
                "-i", "sine=frequency=440:duration=6", "-c:a", "aac", str(mr.TRILHA)],
               check=True)

# clipes falsos: um vertical curto (testa o tpad), os outros horizontais longos
# (testa o crop de 16:9 para 9:16 e o offset de 15%)
clipes = {}
for cid, (w, h, d) in enumerate([(1080, 1920, 1.0), (1920, 1080, 9.0), (720, 1280, 4.0)]):
    p = area / f"clipe-{cid}.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
                    "-i", f"testsrc=size={w}x{h}:rate=25:duration={d}",
                    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                    str(p)], check=True)
    clipes[cid] = p

mr.baixar = lambda url, destino, cabecalhos=None: __import__("shutil").copyfile(
    vozes[int(url.rsplit("-", 1)[1].split(".")[0])] if url.startswith("fake") else vozes[0],
    destino)

# substitui as URLs dos blocos por marcadores locais
mr.BLOCOS = [(f"fake-{i}.wav", lista) for i, (_, lista) in enumerate(mr.BLOCOS)]

def buscar_falso(termo, chave):
    return [{"id": i % 3, "url": f"https://pexels.test/{i}",
             "user": {"name": f"Autor {i}"},
             "video_files": [{"link": "x", "width": 1080, "height": 1920, "quality": "hd"}]}
            for i in range(5)]

mr.buscar = buscar_falso
mr.obter_clipe = lambda video: clipes[video["id"]]
mr.chave_pexels = lambda: "falsa"

saida = area / "saida.mp4"
sys.argv = ["montar-real.py", "--saida", str(saida), "--trocar", "4=1"]
mr.main()

# conferências duras
dur = mr.duracao_ms(saida)
probe = subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries",
     "stream=codec_type,width,height,r_frame_rate,nb_frames", "-of", "json", str(saida)],
    capture_output=True, text=True, check=True).stdout
print("\n--- conferência ---")
print(probe)
esperado = round(sum(DURACOES) * 1000) + 4 * mr.PAUSA_MS
print(f"duração esperada {esperado}ms / obtida {dur}ms / erro {abs(dur - esperado)}ms")
assert abs(dur - esperado) < 400, "linha do tempo fora do esperado"
assert '"width": 1080' in probe and '"height": 1920' in probe, "formato errado"
assert probe.count('"codec_type"') == 2, "faltou trilha de áudio ou de vídeo"
print("OK")
