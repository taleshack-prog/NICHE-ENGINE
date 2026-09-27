-- Cria o banco interno do n8n ao lado do banco da aplicação.
--
-- Roda uma única vez, no primeiro `docker compose up` (entrypoint do Postgres).
-- Se você já tem o volume db-data criado, este arquivo NÃO será executado —
-- crie o banco à mão:  docker compose exec db psql -U niche -c 'CREATE DATABASE n8n;'
--
-- Por que bancos separados: o estado do n8n (execuções, credenciais, workflows)
-- não pode morar no banco da aplicação, senão `prisma migrate reset` apaga os
-- workflows junto com os dados de teste.

SELECT 'CREATE DATABASE n8n'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n')\gexec
