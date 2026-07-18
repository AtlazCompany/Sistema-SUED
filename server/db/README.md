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
