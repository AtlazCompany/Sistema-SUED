# Banco de dados

O schema completo do ERP vive no **Supabase (Postgres)** — fonte da verdade.
As tabelas usam nomes em PascalCase (`"Client"`, `"Event"`…) e colunas em
camelCase (`"clientId"`), herdadas da modelagem inicial.

> Observação: `id` e `updatedAt` não têm default no banco (eram gerados na
> aplicação). Inserts via SQL devem fornecê-los — ver `prepInsert()` em
> `server/utils.js`.

Para gerar um `schema.sql` de referência a partir do banco atual, rode
(com `pg_dump` instalado):

```
pg_dump --schema-only --no-owner "$DATABASE_URL" > schema.sql
```

## Banco de testes (local, em Docker)

Os testes criam e apagam dados de verdade, por isso **nunca** rodam na
produção. `npm test` lê `server/.env.test` (que sobrescreve o
`DATABASE_URL` do `.env`) e a trava `tests/guard-db.js` **pula** os testes
de banco se o endereço não for local.

Primeira vez (precisa do Docker Desktop aberto):

```
docker run -d --name sued-test-db --restart unless-stopped -p 127.0.0.1:54329:5432 \
  -e POSTGRES_PASSWORD=sued_test -e POSTGRES_DB=sued_test -v sued-test-db:/var/lib/postgresql/data \
  postgres:17 -c ssl=on -c ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem \
  -c ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
```

`server/.env.test` (não vai para o git):

```
DATABASE_URL=postgres://postgres:sued_test@127.0.0.1:54329/sued_test
```

Depois, a partir de `server/`:

```
npm run test:setup-db   # cria as tabelas a partir de db/schema.sql (vazio)
npm test
```

`test:setup-db` apaga e recria tudo; recusa rodar se o banco não for local.

### Atualizar `schema.sql` após mudança de schema em produção

Só leitura na produção (estrutura, sem dados), usando o `pg_dump` do container:

```
docker exec -e PGURL="<DATABASE_URL da produção>" sued-test-db sh -c \
  'pg_dump --schema-only --schema=public --no-owner --no-privileges --no-comments "$PGURL"' > db/schema.sql
npm run test:setup-db
```
