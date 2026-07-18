# SUED ERP

ERP empresarial da **SUED** — gestão completa do ciclo operacional, comercial e
financeiro de uma empresa de eventos. O **Evento** é a entidade central: do lead
ao pós-evento.

## Stack

- **Backend:** Node.js + **Express 5** (ES modules)
- **Banco:** PostgreSQL (**Supabase**) via `postgres` (postgres.js) — cliente único
- **Auth:** bcrypt + JWT em cookie httpOnly + RBAC por papéis
- **Frontend:** **vanilla JS** (ES modules) — router/state/api próprios, sem framework
- **Design:** CSS puro com a identidade SUED (mármore branco + dourado)

## Rodando

```bash
cd server
npm install
npm run dev        # http://localhost:4000  (recarrega ao salvar)
```

O Express serve a API em `/api/*` **e** o frontend estático de `public/`.

> Configuração em `server/.env` (não versionado): `PORT`, `JWT_SECRET`,
> `DATABASE_URL` (Postgres do Supabase, session pooler :5432).

Login inicial: `admin@sued.com.br` / `sued@2026` — **troque após o primeiro acesso**.

## Estrutura

```
server/                 Backend Express
  index.js              orquestrador (middlewares, rotas, serve o front)
  config.js             configurações isoladas
  supabaseClient.js     cliente ÚNICO do Postgres/Supabase
  auth.js               login/logout/me + JWT + requireAuth/requireRole
  utils.js              helpers (asyncHandler, toCents, prepInsert…)
  routes/               uma rota por recurso (clientes, dashboard…)
  db/                   referência do schema

public/                 Frontend vanilla (servido pelo Express)
  index.html
  styles/               variables · base · layout · components (identidade SUED)
  src/
    app.js              orquestrador (init, auth, menu, router)
    api.js state.js auth.js router.js config.js utils.js
    components/          icons · toast · modal · table · shell
    views/               login · dashboard · clientes · …
```

Ver [ARQUITETURA.md](ARQUITETURA.md) para o mapa detalhado de responsabilidades.

## Papéis (RBAC)

`ADMIN` · `SOCIO` · `COMERCIAL` · `OPERACIONAL` · `FINANCEIRO`
— o acesso aos módulos é filtrado por papel (`public/src/config.js` e o
middleware `requireRole` no backend).

## Roadmap por fases

1. ✅ Fundação (auth, dashboard, clientes) · 2. Eventos · 3. Fornecedores/catálogo
· 4. Orçamentos/propostas · 5. Operacional · 6. Financeiro · 7. Contratos/docs
· 8. Relatórios · 9. Automações · 10. Agente de IA
