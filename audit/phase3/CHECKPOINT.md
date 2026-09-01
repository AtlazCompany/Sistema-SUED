# CHECKPOINT — SUED SYSTEM — FASE 3

Gestão de Usuários e Segurança de Credenciais. Executada em lote, numa
única sessão, conforme pedido explícito do usuário (auditar, corrigir,
testar e validar sem pausas intermediárias de autorização, exceto para
mudanças arquiteturais/estruturais — nenhuma foi necessária).

---

## 1. Estado inicial (herdado da Fase 2, reconfirmado nesta auditoria)

- Backend Node.js + Express, banco Postgres/Supabase real, driver
  `postgres`, JWT em cookie httpOnly, `bcryptjs`, RBAC com 5 papéis.
- `requireAuth` já revalidava `active`/`role`/nome/e-mail contra o banco
  a cada requisição (correção de sessão da Fase 2) — **não regredida**
  nesta fase, reconfirmada intacta e usada por todos os testes novos.
- Suíte em 116/116 PASS.
- Módulo de usuários (CRUD, RBAC, trava de último admin, tratamento de
  vínculo FK, e-mail normalizado, `passwordHash` nunca exposto, UUID
  inválido → 400) já estava, em sua maior parte, correto e funcional —
  ver `01-auditoria-usuarios.txt` para o detalhe completo do que já
  existia vs. o que faltava.

## 2. Problemas encontrados

**A1 — Confirmação da nova senha ausente.** `PUT /api/auth/senha`
(troca da própria senha) não exigia `confirmNewPassword`; o modal do
frontend também não tinha esse campo. A Fase 3 pede isso explicitamente.

**A2 — E-mail sem validação de formato.** Criação/edição de usuário só
checava presença do e-mail, não formato (`nome@dominio`).

**A3 — Achado de análise (não é bug).** A trava numérica de "último
administrador" (`countOtherActiveAdmins`) ficou estruturalmente
inalcançável via API depois da correção de sessão da Fase 2 — a
autoproteção absoluta (bloqueia sempre que alguém mexe no próprio
papel/status/conta) já garante, por outro caminho, que o sistema nunca
chega a zero admins. Mantida como defesa-em-profundidade. Detalhe
completo em `01-auditoria-usuarios.txt`.

**Ajustes encontrados ao testar (não eram bugs conhecidos antes):**
nome só-com-espaços não era rejeitado na criação (`pick()` não fazia
`.trim()` do nome); o handler de erro do PRÓPRIO arquivo de teste
`usuarios.test.js` estava desatualizado (não tinha o mapeamento
`22P02`→400 que já existe em produção desde a Fase 2), fazendo os novos
testes de UUID inválido acusarem 500 mesmo com o código de produção
correto — corrigido só no teste, confirmado com teste real contra o
servidor rodando que produção nunca teve esse problema.

## 3. Correções

- `server/auth.js` — `PUT /api/auth/senha` exige e valida
  `confirmNewPassword`.
- `server/routes/usuarios.js` — validação de formato de e-mail
  (regex simples); `.trim()` no nome antes de validar/gravar.
- `public/src/auth.js` + `public/src/components/shell.js` — campo
  "Confirmar nova senha" no modal de troca da própria senha.
- `server/tests/usuarios.test.js` — handler de erro do teste alinhado
  com `server/index.js` (22P02→400).

Nenhuma alteração de schema. Nenhuma mudança arquitetural. Nenhuma
funcionalidade fora do escopo desta fase foi tocada (Dashboard,
Financeiro, Operacional, CRM, Eventos, Orçamentos, Contratos, Catálogo,
Relatórios, CSP, menu mobile — todos intocados).

## 4. Arquivos alterados

Backend: `server/auth.js`, `server/routes/usuarios.js`,
`server/tests/usuarios.test.js`.
Frontend: `public/src/auth.js`, `public/src/components/shell.js`.
Documentação: `audit/phase3/01-auditoria-usuarios.txt`,
`02-alteracoes.txt`, `03-testes.txt`, `04-seguranca.txt`,
`05-validacao-real.txt`, `CHECKPOINT.md` (este arquivo) — todos novos.

## 5. Testes

- Antes: 116/116 PASS. Depois: **132/132 PASS, 0 FAIL** (+16 testes
  novos, todos em `usuarios.test.js`; 3 testes existentes de senha
  atualizados, nenhum removido).
- `node --check`: 100% OK em todo `.js` de `server/` e `public/`.
- `inspect-db.mjs`: 23 tabelas, schema íntegro, `User` sem
  `createdAt`/`updatedAt` (reconfirmado, nenhuma migration rodou).

## 6. Validação real

Servidor real (`npm run dev`, porta 4000) + banco real, usuário
temporário `AUDIT-FASE3` (bootstrap admin) + `AUDIT-FASE3-TARGET`
(usuário de teste completo: criar → editar → desativar → reativar →
trocar papel → trocar a própria senha [com validação de confirmação] →
redefinir senha administrativamente → excluir → confirmar remoção).
16/16 passos confirmados com o resultado esperado. Detalhe completo em
`05-validacao-real.txt`. Servidor encerrado corretamente ao final (PID
real confirmado via `netstat` antes do `taskkill`).

## 7. Estado do banco

23 tabelas, schema íntegro, zero resíduo de teste (`audit.fase2.*` e
`audit.fase3.*` confirmados removidos por contagem, não por suposição).
Admin real de produção (`contato.atlazcompany@gmail.com`) confirmado
intacto antes e depois: `active=true`, papel inalterado, senha
inalterada, nunca usado em nenhum teste destrutivo.

## 8. Riscos restantes

1. **Troca de senha não revoga sessões antigas de outros
   dispositivos/abas** (herdado da Fase 2, avaliado nesta fase). Uma
   correção real exigiria versionamento de token (ex.: coluna
   `tokenVersion` em `"User"`, incrementada a cada troca de senha e
   conferida em `resolveSession()`) — isso É uma alteração de schema.
   Conforme a própria instrução da Fase 3 ("se exigir alteração de
   banco significativa, documente antes de fazer"), **não foi
   implementado** — fica como proposta para decisão explícita do
   usuário antes de uma próxima fase.
2. Se o Supabase ficar inacessível, toda rota autenticada devolve 500
   (comportamento deliberado desde a Fase 2, não alterado).
3. TTL do JWT continua em 8h (não alterado).
4. Achado A3 (seção 2 acima) — sem ação recomendada, só registro.

Nenhum risco novo introduzido nesta fase.

## 9. Pendências

Nenhuma pendência P0/P1/P2 conhecida em aberto para o módulo de
usuários. O único item não implementado (revogação de sessão na troca
de senha) foi deliberadamente deixado como proposta, não como
pendência esquecida — decisão explícita, documentada, aguardando o
usuário.

## 10. Próxima fase

Não há uma próxima fase definida pelo usuário ainda. Se o usuário
quiser avançar: nenhuma preparação adicional é necessária — o módulo de
usuários está fechado conforme os critérios de conclusão da Fase 3 (ver
relatório final desta sessão). Se o usuário quiser primeiro decidir
sobre o item 1 da seção 8 (versionamento de token), essa é a única
decisão de arquitetura pendente relacionada a este módulo.
