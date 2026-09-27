-- ─────────────────────────────────────────────────────────────────────────────
-- NICHE ENGINE — SQL de apoio (PostgreSQL / produção)
--
-- As tabelas `topicos` e `config` agora nascem da migração do Prisma
-- (`npx prisma migrate deploy`). Este arquivo existe para dois casos:
--   a) semear a tabela `config` com o token do Meta;
--   b) rodar o n8n contra um banco criado sem passar pelo Prisma.
--
-- Rode APÓS a migração do Prisma.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Token do Meta: FONTE DA VERDADE do sistema.
--    O Workflow D reescreve esta linha a cada ~50 dias. Os Workflows B e C
--    devem LER daqui, nunca de $env — senão a automação morre silenciosamente
--    na primeira rotação.
INSERT INTO config (chave, valor, atualizado_em)
VALUES ('meta_long_lived_token', 'SEU_TOKEN_INICIAL_AQUI', NOW())
ON CONFLICT (chave) DO NOTHING;

INSERT INTO config (chave, valor, atualizado_em)
VALUES ('ig_user_id', 'SEU_IG_USER_ID', NOW())
ON CONFLICT (chave) DO NOTHING;

INSERT INTO config (chave, valor, atualizado_em)
VALUES ('meta_graph_version', 'v21.0', NOW())
ON CONFLICT (chave) DO NOTHING;

-- 2) Snippet que os Workflows B e C devem usar no lugar de {{ $env.META_LONG_LIVED_TOKEN }}:
--
--    SELECT valor AS token FROM config WHERE chave = 'meta_long_lived_token';
--
--    …e então referenciar {{ $('Ler Token').first().json.token }} nos nós HTTP.

-- 3) Índices extras que o Prisma não cria e que o n8n usa de fato.
CREATE INDEX IF NOT EXISTS idx_posts_agendados
  ON posts (agendado_para)
  WHERE status = 'agendado';

CREATE INDEX IF NOT EXISTS idx_posts_publicados_recentes
  ON posts (publicado_em DESC)
  WHERE status = 'publicado' AND ig_post_id IS NOT NULL;

-- 4) Idempotência da coleta de métricas.
--    O Workflow C roda diariamente; sem isto, duas execuções no mesmo dia
--    duplicam a linha e inflam qualquer soma de alcance/salvamentos.
--    O INSERT correto do Workflow C passa a ser:
--
--    INSERT INTO metricas (id, post_id, data_coleta, data_ref, alcance,
--                          salvamentos, compartilhamentos, comentarios)
--    VALUES (gen_random_uuid()::text, '<post_id>', NOW(), TO_CHAR(NOW(), 'YYYY-MM-DD'),
--            0, 0, 0, 0)
--    ON CONFLICT (post_id, data_ref) DO UPDATE SET
--      alcance = EXCLUDED.alcance,
--      salvamentos = EXCLUDED.salvamentos,
--      compartilhamentos = EXCLUDED.compartilhamentos,
--      comentarios = EXCLUDED.comentarios,
--      data_coleta = NOW();
