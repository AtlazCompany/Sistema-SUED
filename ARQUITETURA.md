# Arquitetura do SUED ERP

Guia rápido para qualquer desenvolvedor assumir o projeto.
**Princípio central: cada responsabilidade no seu lugar.**

## Filosofia

Backend e frontend simples e modulares, sem framework pesado. O acesso ao banco
é **sempre no servidor** (Express), então chaves e regras de negócio nunca são
expostas ao navegador. O frontend é vanilla JS com um router/state/api próprios
e enxutos.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Express 5 (ES modules) |
| Banco | PostgreSQL (Supabase) via postgres.js |
| Auth | bcrypt + JWT (cookie httpOnly) + RBAC |
| Frontend | vanilla JS (ES modules) |
| Estilo | CSS puro (identidade SUED) |

## Backend (`server/`)

| Arquivo | Responsabilidade |
|---|---|
| `index.js` | **Orquestrador**: middlewares, monta as rotas, serve o frontend, erro central |
| `config.js` | Configurações (lê `.env` — nenhum outro arquivo lê `process.env`) |
| `supabaseClient.js` | **Cliente único** do Postgres/Supabase (`sql`) |
| `auth.js` | Rotas de login/logout/me + middlewares `requireAuth` / `requireRole` |
| `utils.js` | Helpers (`asyncHandler`, `HttpError`, `toCents`, `nn`, `prepInsert`) |
| `routes/*.js` | Uma rota por recurso (CRUD). Cada recurso no seu arquivo. |

## Frontend (`public/`)

| Arquivo | Responsabilidade | Conceito |
|---|---|---|
| `src/app.js` | **Orquestrador**: init, verifica auth, monta menu, inicia router | `app.js` |
| `src/api.js` | Comunicação central com o backend (GET/POST/PUT/DELETE, erros, 401) | `api.js` |
| `src/state.js` | Estado global mínimo (usuário, rota) — não é depósito de dados | `state.js` |
| `src/auth.js` | Login/logout/sessão (fala com `/api/auth`) | `auth.js` |
| `src/router.js` | Roteamento (History API), params, guarda de rota | `router.js` |
| `src/config.js` | Navegação + RBAC (`canAccess`) | `config.js` |
| `src/utils.js` | Helpers (`el`, `formatBRL`, `formatDate`, `toCents`…) | `utils.js` |
| `src/components/` | `icons` · `toast` · `modal` · `table` · `shell` | `components/` |
| `src/views/*.js` | Uma view por módulo (lógica + interface daquele módulo) | `clientes.js`, … |
| `styles/*.css` | `variables` (tokens SUED) · `base` · `layout` · `components` | `variables.css` |

## Fluxo de uma requisição

```
Navegador → api.js (fetch /api/…) → Express (rota) → requireAuth
   → supabaseClient (sql → Supabase) → JSON de volta → view renderiza
```

## Anatomia de um módulo novo

1. **Backend:** criar `server/routes/<recurso>.js` (Router + `requireAuth`, CRUD via `sql`),
   e registrá-lo em `server/index.js`.
2. **Frontend:** criar `public/src/views/<recurso>.js` (busca via `api.js`, renderiza
   com os componentes), e registrar a rota em `public/src/app.js`.

## Regras de ouro

1. **Dinheiro sempre em centavos** (inteiros). Formatar só na exibição (`formatBRL`).
2. **Acesso ao banco só no servidor.** O frontend nunca fala com o Supabase direto.
3. **Toda chamada de rede passa pelo `api.js`.** Nada de `fetch` solto nas views.
4. **Um cliente de banco só** (`supabaseClient.js`).
5. **Datas "só-dia"** exibidas em UTC (`timeZone: "UTC"`).
6. Tabelas PascalCase (`"Client"`) e colunas camelCase (`"clientId"`) — quote em SQL.
7. `id` e `updatedAt` não têm default no banco → use `prepInsert()` nos INSERTs.
8. **Permissões** via `canAccess(papel, modulo)` (front) e `requireRole(...)` (back).

## Como rodar

Ver [README.md](README.md).
