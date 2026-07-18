# SUED ERP — instruções para agentes

Stack: **Node.js + Express (ES modules)** no backend, **vanilla JS (ES modules)**
no frontend, **Supabase (Postgres)** como banco. Sem framework de frontend.

Princípios (ver `ARQUITETURA.md` para o mapa completo):

- **Cada responsabilidade no seu lugar.** Backend em `server/`, frontend em `public/`.
- **Um cliente único de banco** (`server/supabaseClient.js`) — nenhum módulo cria outro.
- **Toda requisição do frontend passa por `public/src/api.js`** (nada de `fetch` solto).
- **Acesso ao banco só no servidor** (nunca no navegador).
- **Dinheiro sempre em centavos** (inteiros); formatar só na exibição.
- **Datas "só-dia"** exibidas em UTC (`timeZone: "UTC"`) para evitar off-by-one.
- Tabelas são PascalCase (`"Client"`) e colunas camelCase (`"clientId"`) — quote em SQL.
- `id` e `updatedAt` não têm default no banco → use `prepInsert()` nos INSERTs.
- Responder ao usuário em **português (PT-BR)**.

Rodar: `cd server && npm run dev` → http://localhost:4000
