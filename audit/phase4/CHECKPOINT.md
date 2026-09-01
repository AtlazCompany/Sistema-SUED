# CHECKPOINT — SUED SYSTEM — FASE 4

Auditoria funcional completa do sistema inteiro. Ver
`audit/phase4/01-auditoria-funcional.txt` para o relato detalhado por
módulo e por achado — este arquivo é o resumo executivo.

## 1. Estado inicial

Fases 1–3 concluídas: 132/132 testes, RBAC/sessão/segurança de
credenciais validados, banco íntegro (23 tabelas), dados de teste
anteriores removidos, admin real preservado. Banco de produção
genuinamente vazio em todas as tabelas de negócio (só o admin real em
`User`).

## 2. Problemas encontrados

**A1 (corrigido).** 7 rotas `DELETE` (Clientes, Fornecedores, Catálogo
×2, Eventos ×2, Oportunidades) não tratavam violação de FK (Postgres
23503) — um recurso vinculado a outro registro devolvia 500 com o erro
cru do Postgres (nome de tabela/constraint interno vazando pro
cliente HTTP), em vez do 409 amigável que `usuarios.js` já fazia desde
a Fase 2. Reproduzido isoladamente antes de corrigir.

**A2/A3 (registrados, não corrigidos — regra de negócio, não bug).**
Cliente aceita documento duplicado; conta a pagar/receber aceita valor
negativo. Nenhum dos dois causa quebra funcional ou cálculo incorreto
reproduzível — são decisões de política de dados que exigem definição
do usuário, fora do critério de correção desta fase.

**A4/A5 (reconfirmados, já conhecidos desde a Fase 2).** Tipos de
Evento sem tela de CRUD; Locais sem edição (PUT). Lacunas funcionais
deliberadas, não bugs, não implementadas por instrução explícita de
não inventar telas novas.

Nenhum outro problema funcional, de cálculo, de RBAC, de estado vazio
ou de consistência frontend/API/banco foi encontrado nos 14 módulos
auditados.

## 3. Correções

- `server/routes/clientes.js`, `fornecedores.js`, `catalogo.js`,
  `eventos.js`, `oportunidades.js` — captura de erro 23503 → 409
  amigável em 7 rotas DELETE (mesmo padrão já usado em `usuarios.js`).

Nenhuma alteração de schema. Nenhuma mudança arquitetural. Nenhum
módulo fora do escopo desta fase foi tocado.

## 4. Arquivos alterados

- `server/routes/clientes.js`, `server/routes/fornecedores.js`,
  `server/routes/catalogo.js`, `server/routes/eventos.js`,
  `server/routes/oportunidades.js` — correção do achado A1
- `server/tests/fk-delete-guards.test.js` — **novo** (7 testes de
  regressão para o achado A1)
- `server/audit-phase4-run.mjs` — **novo** (harness de auditoria
  funcional, ferramenta — não faz parte do app, mesmo espírito de
  `audit-phase2-run.mjs`)
- `audit/phase4/01-auditoria-funcional.txt`, `CHECKPOINT.md` — **novos**

## 5. Testes

- Antes desta fase: 132/132 PASS. Depois: **139/139 PASS, 0 FAIL**
  (`npm test`) — +7 testes novos (`fk-delete-guards.test.js`), nenhum
  removido.
- `node --check`: 100% OK em todo `.js` de `server/` e `public/`.
- `inspect-db.mjs`: 23 tabelas, schema íntegro — nenhuma migration
  rodou nesta fase.

## 6. Testes reais

- **Harness HTTP completo** (`audit-phase4-run.mjs`, servidor Express
  real + Supabase real, dados `AUDIT-FASE4-*`): 169 verificações PASS,
  0 FAIL, cobrindo os 14 módulos, o fluxo de integração completo (Lead
  → Cliente → Oportunidade → Evento → Orçamento → Contrato →
  Operacional → Financeiro → Relatório com IDs encadeados reais), RBAC
  funcional (GET completo + amostra de escrita POST/PUT/DELETE),
  verificação matemática contra o banco (dashboard, orçamento,
  financeiro, relatórios), e casos de erro propositais.
- **Navegador real**: sessão completa com usuário temporário
  `AUDIT-FASE4-BROWSER`, percorrendo os 14 módulos em 4 larguras (375,
  390, 768, 1280px) — zero erro de console em qualquer tela, zero
  overflow horizontal, estados vazios corretos (mensagens amigáveis,
  nenhum `undefined`/`NaN`/`Invalid Date`), fluxo real de criação
  (Cliente) confirmado: formulário → toast → tabela atualizada sem
  reload.
- **Reprodução isolada do achado A1** antes de corrigir (script
  descartável, não versionado): confirmado o erro 23503 cru vazando.

Limpeza confirmada ao final de cada rodada: contagens de todas as 21
tabelas de negócio voltaram exatamente ao estado anterior; zero
resíduo `AUDIT-FASE4-*`/`audit.fase4.*`; admin real de produção
(`contato.atlazcompany@gmail.com`) confirmado intacto (`active=true`,
papel/senha inalterados) antes e depois.

## 7. Segurança

Nenhum erro devolveu stack trace, SQL cru (depois da correção A1),
`passwordHash`, `DATABASE_URL` ou `JWT_SECRET` — confirmado por
inspeção de cada resposta de erro gerada nesta auditoria. RBAC
reconfirmado funcionalmente (não só por leitura de matriz) para GET e
para uma amostra representativa de escrita. Autenticação/sessão da
Fase 2 e gestão de usuários/senha da Fase 3 não foram tocadas nem
regredidas.

## 8. Estado do banco

23 tabelas, schema íntegro, zero resíduo de teste, admin real intacto.
Banco de produção segue genuinamente vazio em todas as tabelas de
negócio (esperado — sistema ainda não está em uso operacional real).

## 9. Riscos restantes

Nenhum risco novo introduzido. Riscos já documentados nas fases
anteriores (troca de senha não revoga sessões de outros dispositivos;
Supabase indisponível → 500 em rotas autenticadas; TTL do JWT em 8h)
permanecem inalterados e fora do escopo desta fase.

## 10. Pendências

Nenhuma pendência técnica (bug) em aberto. Duas decisões de produto
ficam registradas para o usuário decidir, não como bugs esquecidos:
- Bloquear ou não documento duplicado em Cliente (achado A2).
- Bloquear ou não valor negativo em contas a pagar/receber (achado A3).

Duas lacunas funcionais conhecidas (não corrigidas por instrução
explícita de não inventar telas): CRUD de Tipos de Evento; edição de
Locais.

## 11. Próxima fase

Nenhuma definida pelo usuário. Se quiser avançar: o sistema está
funcionalmente validado ponta a ponta nos 14 módulos, sem regressão
conhecida. Se quiser primeiro decidir sobre os achados A2/A3, essas são
as únicas decisões de produto em aberto ligadas a esta fase.
