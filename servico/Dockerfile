# Serviço `niche` — Python, ffmpeg e um volume. É o que a Vercel não pode ser.
#
# Construído a partir da RAIZ do repositório, não desta pasta:
#   docker build -f servico/Dockerfile -t niche .
# O serviço importa o pacote `niche/` e os módulos de `scripts/`, que são o
# código que produziu os episódios publicados. Copiá-los para dentro de
# servico/ criaria uma segunda cópia que envelhece sozinha.

FROM python:3.11-slim

# ffmpeg monta e mistura; fontconfig é o que faz o matplotlib enxergar fontes.
# --no-install-recommends corta ~200 MB de dependências sugeridas que ninguém
# usa aqui.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# As dependências vêm ANTES do código: assim uma mudança de roteiro não
# invalida a camada do pip, e o deploy cai de minutos para segundos.
COPY servico/requirements.txt ./servico/requirements.txt
RUN pip install --no-cache-dir -r servico/requirements.txt

COPY niche ./niche
COPY scripts ./scripts
COPY servico ./servico
COPY assets/fontes ./assets/fontes

# O volume do Railway é montado aqui. Nada que importe mora na imagem: o
# contêiner é refeito a cada deploy e o disco dele vai junto.
ENV NICHE_DADOS=/dados \
    PYTHONUNBUFFERED=1 \
    MPLCONFIGDIR=/tmp/matplotlib
RUN mkdir -p /dados

EXPOSE 8000
# `sh -c` para o $PORT do Railway ser expandido em tempo de execução: em forma
# de lista o shell não entra, e o uvicorn receberia a string "$PORT".
CMD ["sh", "-c", "uvicorn servico.app:api --host 0.0.0.0 --port ${PORT:-8000}"]
