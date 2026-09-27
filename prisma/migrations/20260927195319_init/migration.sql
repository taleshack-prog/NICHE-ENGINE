-- CreateTable
CREATE TABLE "nichos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "sub_nicho" TEXT,
    "cpm_estimado" DOUBLE PRECISION,
    "demanda_perene" INTEGER,
    "concorrencia" INTEGER,
    "score" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'candidato',
    "persona" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nichos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates_virais" (
    "id" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "transcricao" TEXT,
    "gancho" TEXT NOT NULL,
    "estrutura" TEXT NOT NULL DEFAULT '{}',
    "padrao" TEXT NOT NULL,
    "performance" INTEGER,
    "nicho_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "templates_virais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "formato" TEXT NOT NULL,
    "roteiro" TEXT,
    "legenda" TEXT,
    "hashtags" TEXT,
    "cover_text" TEXT,
    "midia_paths" TEXT,
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "agendado_para" TIMESTAMP(3),
    "publicado_em" TIMESTAMP(3),
    "ig_post_id" TEXT,
    "erro_publicacao" TEXT,
    "nicho_id" TEXT NOT NULL,
    "template_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metricas" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "data_coleta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_ref" TEXT NOT NULL,
    "alcance" INTEGER,
    "impressoes" INTEGER,
    "salvamentos" INTEGER,
    "compartilhamentos" INTEGER,
    "comentarios" INTEGER,
    "follows_ganhos" INTEGER,
    "retention_3s" DOUBLE PRECISION,
    "watch_rate" DOUBLE PRECISION,

    CONSTRAINT "metricas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ganchos" (
    "id" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "usos" INTEGER NOT NULL DEFAULT 0,
    "vitorias" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ganchos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topicos" (
    "id" SERIAL NOT NULL,
    "tema" TEXT NOT NULL,
    "nicho_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config" (
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE INDEX "nichos_status_idx" ON "nichos"("status");

-- CreateIndex
CREATE INDEX "nichos_score_idx" ON "nichos"("score");

-- CreateIndex
CREATE INDEX "templates_virais_nicho_id_idx" ON "templates_virais"("nicho_id");

-- CreateIndex
CREATE INDEX "templates_virais_padrao_idx" ON "templates_virais"("padrao");

-- CreateIndex
CREATE INDEX "posts_status_idx" ON "posts"("status");

-- CreateIndex
CREATE INDEX "posts_agendado_para_idx" ON "posts"("agendado_para");

-- CreateIndex
CREATE INDEX "posts_nicho_id_idx" ON "posts"("nicho_id");

-- CreateIndex
CREATE INDEX "posts_publicado_em_idx" ON "posts"("publicado_em");

-- CreateIndex
CREATE INDEX "metricas_data_coleta_idx" ON "metricas"("data_coleta");

-- CreateIndex
CREATE UNIQUE INDEX "metricas_post_id_data_ref_key" ON "metricas"("post_id", "data_ref");

-- CreateIndex
CREATE INDEX "ganchos_categoria_idx" ON "ganchos"("categoria");

-- CreateIndex
CREATE INDEX "topicos_status_prioridade_idx" ON "topicos"("status", "prioridade");

-- AddForeignKey
ALTER TABLE "templates_virais" ADD CONSTRAINT "templates_virais_nicho_id_fkey" FOREIGN KEY ("nicho_id") REFERENCES "nichos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_nicho_id_fkey" FOREIGN KEY ("nicho_id") REFERENCES "nichos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates_virais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metricas" ADD CONSTRAINT "metricas_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topicos" ADD CONSTRAINT "topicos_nicho_id_fkey" FOREIGN KEY ("nicho_id") REFERENCES "nichos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
