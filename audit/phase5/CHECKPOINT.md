# CHECKPOINT — SUED SYSTEM — FASE 5

Auditoria de regras de negócio e completude funcional, seguida de
implementação em lotes autorizados individualmente pelo usuário.

---

## 1. Auditoria (somente leitura, sem alteração de código/banco)

Ver `audit/phase5/01-auditoria-regras-negocio.txt`. Nenhum P0. 1
achado P1 (B1, novo — escrita com FK inexistente vazando 500 com SQL
cru). 9 achados P2 (decisões de regra de negócio pendentes e gaps
técnicos menores). 8 achados P3 (majoritariamente já conhecidos desde
fases anteriores). Confirmado nesta auditoria: nenhum vetor de XSS,
RBAC/sessão/cálculos financeiros sem novo achado.

## 2. Lote 1 (autorizado e concluído) — B1 + B6

Ver `audit/phase5/02-lote1-b1-b6.txt` para o relato completo.

**B1** — 15 rotas `POST`/`PUT` em 7 arquivos (`eventos.js`,
`oportunidades.js`, `orcamentos.js`, `contratos.js`, `operacional.js`,
`financeiro.js`, `catalogo.js`) passaram a tratar o erro Postgres
`23503` (referência a registro inexistente) com `400` amigável, mesmo
padrão já validado nas rotas `DELETE` desde a Fase 4. Antes: 500 com a
mensagem crua do driver Postgres (nome de tabela/constraint vazando).

**B6** — `PUT /api/auth/senha` ganhou rate limit (mesmo padrão do
login: janela de 10 min, 8 tentativas, `Retry-After`, 429), chaveado
por usuário (não por IP, já que a rota exige sessão autenticada). Só
tentativas de senha atual errada consomem a cota.

**Não implementado neste lote** (por instrução explícita): B2, B3,
B4, B5, B18, B10 (decisões de regra de negócio), B7/tokenVersion,
trilha de auditoria (B9), CRUD de Contact (B8). Nenhuma alteração de
schema.

**Ambiguidades**: nenhuma exigiu parar — as únicas decisões tomadas
foram técnicas (código HTTP, redação de mensagem, chave do rate
limit), dentro do escopo já autorizado, sem tocar regra de negócio.

## 3. Arquivos alterados (Lote 1)

Backend: `server/routes/eventos.js`, `oportunidades.js`,
`orcamentos.js`, `contratos.js`, `operacional.js`, `financeiro.js`,
`catalogo.js`, `auth.js`.
Testes novos: `server/tests/fk-write-guards.test.js` (28 testes),
`server/tests/password-change-rate-limit.test.js` (4 testes).
Documentação: `audit/phase5/01-auditoria-regras-negocio.txt`,
`02-lote1-b1-b6.txt`, `CHECKPOINT.md` (este arquivo).

## 4. Testes

Antes do Lote 1: 139/139 PASS. Depois: **171/171 PASS, 0 FAIL**
(+32 testes novos, nenhum removido). `node --check`: 100% OK em
`server/` e `public/`. `inspect-db.mjs`: 23 tabelas, schema íntegro,
nenhuma migration rodou.

## 5. Validação real

Servidor Express real (porta 4000) + Supabase real. Confirmado ao
vivo: as 3 classes de rota testadas manualmente (Eventos, Catálogo,
Financeiro) devolvem 400 amigável para referência inexistente; o rate
limit de troca de senha bloqueia na 9ª tentativa com `Retry-After`,
sem afetar o login normal da mesma conta. Um servidor zumbi de sessão
anterior foi encontrado ocupando a porta 4000 antes desta validação —
identificado e encerrado corretamente (PID real via `netstat`) antes
de subir a versão com as correções.

Usuário temporário `AUDIT-FASE5-SESSION` e dados `AUDIT-FASE5-*`
(automatizados) removidos e confirmados por contagem — zero resíduo.
Admin real de produção (`contato.atlazcompany@gmail.com`) confirmado
intacto antes e depois.

## 6. Lote 2, parte 1 (autorizado e concluído) — análise de regra de
   negócio (B2/B3/B4/B5/B10/B18) + B7

Ver `audit/phase5/01-auditoria-regras-negocio.txt` (seções adicionadas
na conversa, não em arquivo próprio) para a análise detalhada de
B2/B3/B4/B5/B10/B18 — cada um com comportamento atual, exemplos,
regra proposta, exceções, risco. **Nenhum desses seis foi implementado
— seguem PENDENTES DE DECISÃO DO CONSULTOR do usuário**, por instrução
explícita. Não há constraint, validação ou comportamento novo no banco
ou no código para nenhum deles.

**B7 — implementado e validado.** Ver
`audit/phase5/03-lote2-b7.txt` para o relato completo (análise de
impacto A–L apresentada e aprovada antes de qualquer alteração,
depois implementação, testes, validação real). Resumo:
- Única alteração de schema desta fase, autorizada explicitamente:
  `"User"."tokenVersion"` (integer, not null, default 0) — aditiva,
  reversível, sem tocar dado existente (admin real recebeu
  `tokenVersion=0` automaticamente).
- `server/auth.js` e `server/routes/usuarios.js`: trocar a própria
  senha OU um admin redefinir a senha de outra pessoa agora invalida
  imediatamente qualquer sessão mais antiga dessa conta (outro
  dispositivo/aba), sem esperar o JWT expirar sozinho (até então, até
  8h). A sessão que fez a própria troca continua funcionando
  normalmente (cookie reemitido).
- Um bug foi encontrado e corrigido DURANTE os testes desta
  implementação (não era conhecido antes): o dublê de banco de
  `password-change-rate-limit.test.js` (Lote 1) quebrava com o novo
  formato de UPDATE — corrigido só no teste, não era um problema de
  produção.

**Ambiguidades de regra de negócio nesta etapa**: nenhuma — B7 é
puramente técnico, não decide nada sobre B2–B5/B10/B18.

## 7. Testes (acumulado)

Fase 5 até aqui: 139 → 171 (Lote 1) → **176/176 PASS, 0 FAIL** (Lote 2
parte 1 / B7, +5 testes). `node --check`: 100% OK. `inspect-db.mjs`:
23 tabelas, schema íntegro, `"User"` com a nova coluna `tokenVersion`.

## 8. Validação real (B7)

Servidor Express real + Supabase real: 2 sessões simultâneas da mesma
conta, troca de senha numa delas invalida a outra mas mantém a que fez
a troca; admin redefine a senha de outra conta e invalida a sessão que
essa pessoa já tinha aberta. Usuários temporários
`AUDIT-FASE5-B7`/`AUDIT-FASE5-B7-TARGET` removidos, zero resíduo,
admin real confirmado intacto (`tokenVersion=0`, nunca tocado).

## 9. Lote 2, parte 2 (autorizado e concluído) — B8, CRUD de Contact

Ver `audit/phase5/04-lote2-b8.txt` para o relato completo (inventário,
plano, implementação, testes, validação real e visual). Resumo:

- **Inventário**: `Contact` já existia no schema (4 colunas: id,
  clientId, name, primary), só era LIDO (embutido em
  `GET /api/clientes/:id`) — nenhuma rota de escrita, nenhuma tela.
- **Backend** (`server/routes/clientes.js`): `POST
  /:clientId/contatos`, `PUT /contatos/:id`, `DELETE /contatos/:id` —
  mesmo módulo RBAC de Cliente (`crm`), mesmo tratamento de FK do B1.
  `primary` (contato principal) segue o mesmo padrão de exclusividade
  já usado em `SupplierProduct.isDefault` — no máximo um principal por
  cliente.
- **Frontend** (`public/src/views/clientes.js`): botão "Contatos" por
  linha abre um modal (mesmo padrão de `categoriesModal` do Catálogo)
  — sem tela de detalhe nova, sem redesign.
- **Nenhuma alteração de schema** — `Contact` já existia.

**Ambiguidades**: nenhuma — a única escolha foi técnica (reusar o
padrão de exclusividade já existente no projeto).

## 10. Testes (acumulado)

Fase 5 até aqui: 139 → 171 (Lote 1) → 176 (B7) → **189/189 PASS,
0 FAIL** (B8, +13 testes em `server/tests/contatos.test.js`).
`node --check`: 100% OK. `inspect-db.mjs`: 23 tabelas, schema íntegro.

## 11. Validação real e visual (B8)

HTTP real: criar cliente → criar contato → ler embutido → renomear →
excluir contato → excluir cliente, todos OK. Visual (navegador real,
usuário `AUDIT-FASE5-B8UI`): botão "Contatos" na lista, modal com
estado vazio, adicionar 2 contatos alternando "Principal" (confirmada
a exclusividade nos dois sentidos visualmente), exclusão via UI
bloqueada pelo `confirm()` nativo do navegador (proteção existente
funcionando, não uma falha — limpeza feita via SQL). Zero resíduo,
admin real intacto.

## 12. Riscos restantes

B2, B3, B4, B5, B10, B18 seguem pendentes de decisão do consultor do
usuário — documentados em detalhe, nada implementado, nenhuma
constraint/validação nova para eles. Nenhum risco novo introduzido por
B7 ou B8.

## 13. B9 — só proposta, não implementado

Proposta de escopo em `audit/phase5/05-proposta-b9.txt`. As 6 decisões
foram apresentadas ao usuário em formato estruturado (o que decidir,
comportamento atual, opções, recomendação técnica, impacto, natureza
técnica/regra-de-negócio, consequência de adiar) — ainda aguardando
resposta. Nenhuma alteração de código ou schema para B9.

## 14. Lote 3 (autorizado e concluído) — B11 + B12 + B15

Ver `audit/phase5/06-lote3-b11-b12-b15.txt` para o relato completo.
Resumo:

- **B11** (gestão mínima de Tipos de Evento): novo router
  `tiposEventoRouter` (`server/routes/eventos.js`, montado em
  `/api/tipos-evento`) — criar + listar (com contagem de eventos) +
  excluir (409 amigável se vinculado), mesmo padrão de `Category`.
  Modal no frontend (`eventos.js`), mesmo padrão de `categoriesModal`.
- **B12** (edição de Locais): novo `PUT /api/locais/:id`
  (`locaisRouter`) + botão/formulário de edição no frontend
  (`locais.js`), mesmo padrão de `clientForm`/`productForm`.
- **B15** (modais empilhados): `public/src/components/modal.js` —
  `openModal()` agora fecha o modal atualmente aberto (se houver)
  antes de abrir um novo. Sem redesign.
- **Nenhuma alteração de schema** — `EventType` e `Venue` já existiam.

**2 bugs técnicos pré-existentes encontrados e corrigidos durante a
implementação** (nenhuma decisão de regra de negócio envolvida):
  1. `nn()` não faz `trim()` — nome só-com-espaços passava a validação
     em `POST /tipos-evento` e `POST`/`PUT /locais`. Corrigido nos 3
     pontos.
  2. Checkbox "Local próprio" (`isOwn`) nunca funcionava ao criar um
     Local pela tela — `form.querySelector` buscava dentro do
     `<form>`, mas o checkbox é irmão dele, fora — sempre lançava
     `TypeError` antes de enviar a requisição. **Bug pré-existente,
     não introduzido nesta fase** — a criação de Local pela UI nunca
     funcionou até esta correção. Corrigido com
     `form.parentElement.querySelector(...)`, mesmo padrão já usado em
     `clientForm`/`productForm`.

**Ambiguidades**: nenhuma — os dois bugs são técnicos e objetivos.

## 15. Testes (acumulado)

Fase 5 até aqui: 139 → 171 (Lote 1) → 176 (B7) → 189 (B8) →
**203/203 PASS, 0 FAIL** (Lote 3, +14 testes em `server/tests/
tipos-evento-e-locais.test.js`). `node --check`: 100% OK.
`inspect-db.mjs`: 23 tabelas, schema íntegro.

Durante a primeira execução da suíte completa deste lote, um
`CONNECT_TIMEOUT` transitório do Postgres (instabilidade de rede, não
relacionado ao código) interrompeu a limpeza de um teste da Fase 4
(`fk-delete-guards.test.js`) e deixou 1 usuário de teste órfão —
identificado, removido, suíte inteira reexecutada com sucesso total
para confirmar que não era regressão.

## 16. Validação real e visual (Lote 3)

HTTP real: Tipo de Evento (criar/listar/vincular/409/desvincular/
excluir) e Local (criar/editar/confirmar na listagem), todos OK — 1
achado à parte: um `EventType` com nome em branco ficou gravado
durante a reprodução do bug #1 (antes da correção) e foi removido
manualmente antes da limpeza final. Visual (navegador real, usuário
`AUDIT-FASE5-LOTE3UI`): botão "Tipos de evento" na tela de Eventos,
modal funcionando; **B15 confirmado** (abrir "Novo evento" com o modal
de Tipos ainda aberto → só 1 `.modal-backdrop` no DOM, o anterior foi
removido); **bug #2 reproduzido ao vivo e depois confirmado corrigido**
(criar Local com "Local próprio" marcado → sucesso); edição de Local
confirmada refletindo na listagem. Zero resíduo, admin real intacto
(`tokenVersion=0`, nunca tocado). Servidor encerrado, porta 4000 livre.

## 17. Riscos restantes

B2, B3, B4, B5, B10, B18 seguem pendentes de decisão do consultor do
usuário — nada implementado. B9 aguardando as 6 decisões. Nenhum risco
novo introduzido por B7/B8/B11/B12/B15 — os 2 bugs encontrados foram
corrigidos e testados.

## 18. Lote 4 (autorizado e concluído) — B13 + B16 + B17

Ver `audit/phase5/07-lote4-b13-b16-b17.txt` para o relato completo.
Resumo:

- **B13** (paginação mínima e compatível): novo helper
  `parsePagination()` (`server/utils.js`) — sem `page`/`pageSize` na
  query, comportamento 100% idêntico ao anterior (array completo, sem
  header extra); com os dois parâmetros válidos, aplica `limit/offset`
  e adiciona `X-Total-Count`. Aplicado aos 8 endpoints de maior risco
  de crescimento: `clientes.js`, `leads.js`, `oportunidades.js`,
  `eventos.js`, `orcamentos.js`, `contratos.js`, `financeiro.js`
  (`/receber` e `/pagar`). Nos dois com filtro (`clientes?q=`,
  `eventos?status=`), o total do header respeita o mesmo filtro.
  Nenhuma migração geral do frontend — nenhuma tela usa os parâmetros
  novos hoje.
- **B16** (padronização das 19 rotas `DELETE` idempotentes para 404):
  `DELETE ... RETURNING id` + 404 amigável quando o recurso não existe,
  em 10 arquivos (`clientes.js`, `catalogo.js`, `contratos.js`,
  `financeiro.js`, `eventos.js`, `fornecedores.js`, `leads.js`,
  `operacional.js`, `oportunidades.js`, `orcamentos.js`) —
  `usuarios.js` já era a referência e não foi alterado. Tratamento de
  FK (`23503` → 409) preservado em todas as rotas que já o tinham.
- **B17**: arquivado como "sem problema técnico comprovado" — nenhuma
  alteração de código.
- **Nenhuma alteração de schema.**

**Instabilidade de ambiente observada (não é bug de código)**: suíte
completa via `npm test` (concorrência padrão) apresentou falhas
intermitentes de conexão com o Supabase em alguns arquivos — mesmo
padrão do `CONNECT_TIMEOUT` já registrado no Lote 3, agora mais visível
com a suíte maior. Confirmado sem regressão reexecutando com
`--test-concurrency=1`: **230/230 PASS**. Nenhuma alteração de código
por causa disso.

**Ambiguidades de regra de negócio**: nenhuma — B13 e B16 são
puramente técnicos (contrato de API), B17 foi arquivado exatamente
como decidido.

## 19. Testes (acumulado)

Fase 5 até aqui: 139 → 171 (Lote 1) → 176 (B7) → 189 (B8) → 203
(Lote 3) → **230/230 PASS, 0 FAIL** (Lote 4, +27 testes:
`server/tests/pagination.test.js` com 9, `server/tests/
delete-404.test.js` com 18). `node --check`: 100% OK.
`inspect-db.mjs`: 23 tabelas, schema íntegro, nenhuma migration.

## 20. Validação real (Lote 4)

Servidor Express real + Supabase real, usuário temporário
`AUDIT-FASE5-LOTE4`: `DELETE` de cliente inexistente → 404 amigável;
`GET /api/leads` sem parâmetros → comportamento antigo preservado
(sem header); `GET /api/leads?page=1&pageSize=1` → header
`X-Total-Count` presente; criar Fornecedor → excluir (200) → excluir
de novo o mesmo id (404). Zero resíduo (`AUDIT-FASE5-LOTE4*` e
`AUDIT-FASE5-B13/B16-*`), admin real confirmado intacto
(`tokenVersion=0`, `active=true`, nunca tocado). Servidor encerrado
corretamente, porta 4000 livre.

## 21. Riscos restantes

B2, B3, B4, B5, B10, B18 seguem pendentes de decisão do consultor do
usuário — nada implementado. B9 aguardando as 6 decisões. B14
(recuperação de senha por e-mail) segue explicitamente fora de escopo.
Nenhum risco novo introduzido por B13/B16/B17.

## 22. Releitura técnica (somente leitura) + Lote 5 — B19 + B20 + B21

O usuário mudou a estratégia nesta janela: em vez de autorização por
item, concedeu autonomia para decisões técnicas de baixo risco (sem
regra de negócio, sem schema não autorizado, sem serviço externo, sem
trade-off de segurança significativo, sem mudança arquitetural),
pedindo para levar o projeto ao máximo de conclusão técnica possível
mantendo B2/B3/B4/B5/B9/B10/B14/B18 intocados.

Releitura completa do código atual (todas as 13 rotas de backend,
`auth.js`, `utils.js`, `index.js`, `dashboard.js`, `relatorios.js`, e
o frontend relevante — infraestrutura + módulos tocados nos Lotes
1–4) — ver `audit/phase5/08-auditoria-releitura.txt`. Achados novos:

- **B19 (P1)** — `POST /api/oportunidades/:id/interacoes` sem
  tratamento de FK inexistente (mesma classe do B1, mas a referência
  vem do parâmetro de rota, não do corpo — por isso ficou fora do
  inventário original).
- **B20 (P3)** — `public/src/router.js` usava `innerHTML` sem escape
  no fallback de erro de carregamento de view. Não explorável hoje
  (toda mensagem de erro do backend é texto fixo), mas inconsistente
  com o padrão seguro do resto do projeto.
- **B21 (P3)** — Maps de rate limit em `server/auth.js` (B6) nunca
  purgavam entradas expiradas — vazamento de memória lento e sem
  limite ao longo da vida do processo.

**Implementação (Lote 5)** — ver
`audit/phase5/09-lote5-b19-b20-b21.txt` para o relato completo:
- B19: `try/catch` no INSERT de `"Interaction"`, 23503 → 400
  "Oportunidade selecionada não existe mais." (mesmo padrão de B1/B8).
- B20: `innerHTML` trocado por `createElement`/`textContent` (mesmo
  padrão de `toast.js`/`el()`).
- B21: varredura periódica (`setInterval` de 10 min, `.unref()`) que
  remove entradas expiradas dos dois Maps.
- **Nenhuma alteração de schema.**

**Ambiguidades de regra de negócio**: nenhuma — os três achados são
puramente técnicos.

## 23. Testes (acumulado)

Fase 5 até aqui: 139 → 171 (Lote 1) → 176 (B7) → 189 (B8) → 203
(Lote 3) → 230 (Lote 4) → **232/232 PASS, 0 FAIL** (Lote 5, +2 testes
em `server/tests/fk-write-guards.test.js`, arquivo já existente,
estendido em vez de criar um novo). `node --check`: 100% OK em TODOS
os `.js` de `server/` e `public/src/` (verificação completa).
`inspect-db.mjs`: 23 tabelas, schema íntegro, nenhuma migration.

## 24. Validação real e visual (Lote 5)

HTTP real: `POST /oportunidades/<id-inexistente>/interacoes` → 400
amigável (antes: 500 cru); com id válido → 201, sem regressão. Visual
(navegador real, admin temporário `AUDIT-FASE5-LOTE5-UI`): falha de
rede forçada na tela de Relatórios → mensagem de erro renderizada como
texto puro (confirmado via `outerHTML`: `createElement`/`textContent`,
nenhum `innerHTML` no caminho). Zero resíduo (`AUDIT-FASE5-LOTE5*`,
`audit.fase5.lote5*`), admin real confirmado intacto (`tokenVersion=0`,
`active=true`, nunca tocado) — inclusive reconfirmado que o único
usuário com papel ADMIN/SOCIO na base é o admin real, após o término
completo da suíte de testes (um resíduo transitório observado durante
a execução em background era o próprio admin de bootstrap de
`delete-404.test.js`, ainda não limpo por seu `after()` naquele
instante — não era resíduo real).

## 25. Riscos restantes

B2, B3, B4, B5, B10, B18 seguem pendentes de decisão do consultor do
usuário — nada implementado. B9 aguardando as 6 decisões. B14 segue
explicitamente fora de escopo (recuperação de senha por e-mail —
decisão de arquitetura/serviço externo, ver seção 26). Nenhum risco
técnico novo conhecido — B19/B20/B21 fecham os achados da releitura.
Nenhum P0, P1 ou P2 técnico simples conhecido em aberto no momento.

## 26. B9 (implementado) — trilha de auditoria técnica

Usuário decidiu as 3 questões pendentes: amplitude = só Financeiro/
Contratos/Usuários (não os 12 módulos); retenção = indefinida por
enquanto (sem expurgo automático); entrega = só tabela + consulta
técnica direta (sem tela própria). Snapshot completo (não diff) usado
como antes/depois, conforme recomendação técnica já registrada na
proposta. Autorização explícita de schema obtida antes da criação.

- **Schema** (aditivo, `server/setup-audit-log.mjs`, idempotente):
  nova tabela `"AuditLog"` (id, table, recordId, action, userId,
  userName, before jsonb, after jsonb, createdAt) + 3 índices
  (table+recordId, userId, createdAt).
- **`server/audit.js`**: `logAudit(executor, {...})` — grava na MESMA
  transação da operação principal quando chamado com `tx` (nunca
  "perde" um evento); `userName` congelado no momento da ação (log
  continua legível mesmo se o usuário for excluído depois); redação
  explícita por tabela (`REDACT_FIELDS.User = ["passwordHash"]` —
  nunca grava hash de senha em `before`/`after`).
- Aplicado nas rotas de escrita de `usuarios.js`, `financeiro.js` e
  `contratos.js` (criar/editar/excluir/redefinir senha).
- Leitura só via SQL direto (nenhuma tela nova, conforme decidido).

## 27. B14 (implementado) — recuperação de senha por e-mail

Usuário escolheu avaliar opções de provedor; provedor definido:
**Resend**. Chave (`RESEND_API_KEY`) ainda NÃO configurada em
`server/.env` — o sistema roda em modo de desenvolvimento (link de
redefinição registrado no console do servidor, nunca bloqueando o
fluxo) até a chave ser provisionada. Nenhuma cobrança nem conta foi
criada por mim — só o código-cliente do provedor foi integrado.

- **Schema** (aditivo): 2 colunas novas em `"User"` — `resetTokenHash`
  (text, nullable) e `resetTokenExpiresAt` (timestamptz, nullable) —
  em vez de uma tabela separada (mais simples, suficiente para um
  token ativo por usuário).
- **`server/mail.js`**: `sendPasswordResetEmail()` via Resend; sem
  `RESEND_API_KEY`, cai em modo dev (loga o link) em vez de falhar;
  nunca lança (o chamador não deve saber se o envio falhou — mesma
  resposta ao usuário de qualquer forma).
- **`server/auth.js`**: `POST /esqueci-senha` (sempre responde igual,
  exista ou não a conta — proteção contra enumeração; rate limit por
  e-mail E por IP) e `POST /redefinir-senha` (token de 256 bits,
  armazenado só como hash SHA-256, nunca em texto puro; expira em 30
  min; uso único — limpo após o uso; incrementa `tokenVersion`
  [achado B7] para invalidar sessões antigas; rate limit por IP na
  confirmação). Nova dependência: `resend` (`server/package.json`).
- **Frontend** (`public/src/views/login.js`, `auth.js`, `app.js`):
  link "Esqueci minha senha" na tela de login; página
  `/redefinir-senha?token=...` tratada como rota especial (funciona
  sem sessão).
- B9 aplicado à própria redefinição (log da ação, sem before/after
  sensível).

**Ambiguidades**: nenhuma nova — as decisões de arquitetura (schema,
formato do token, TTL, rate limit) foram técnicas dentro do que já
tinha sido avaliado; a única decisão de produto (qual provedor) foi
do usuário.

## 28. Lote 6 — fechamento e validação final (B19+B20+B21+B9+B14)

Ao rodar a suíte completa para fechar esta etapa, uma **regressão
real** foi encontrada (não instabilidade de infraestrutura):
`"AuditLog"."userId" REFERENCES "User"("id")` foi criada com o padrão
`RESTRICT` do Postgres em vez de `ON DELETE SET NULL` — contradizendo
o próprio design já documentado do B9 ("`userName` congelado... para o
log continuar legível mesmo que o usuário seja excluído depois").
Isso quebrou testes pré-existentes (não relacionados ao B9) que
excluem `User` via SQL direto (`usuarios.test.js`,
`fk-write-guards.test.js`), porque qualquer usuário que já tivesse
uma ação seguindo pelo B9 (ex.: como ator de uma criação/edição em
Financeiro/Contratos/Usuários) passou a ficar bloqueado para exclusão.

**Diagnóstico**: reproduzido isoladamente (`PostgresError 23505`
inicial revelou um resíduo órfão de uma execução interrompida
anteriormente; a limpeza desse resíduo expôs o erro real,
`23503` da FK `AuditLog_userId_fkey`, ao tentar apagar o usuário).
Confirmado como bug de implementação (constraint não bateu com o
design já aprovado), não uma nova decisão de arquitetura.

**Correção** (autorização explícita do usuário obtida antes, por
exigir `ALTER TABLE`): `DROP CONSTRAINT` + `ADD CONSTRAINT ... ON
DELETE SET NULL` na coluna `"AuditLog"."userId"` — rodada manualmente
pelo usuário via painel SQL do Supabase (o classificador do ambiente
bloqueou a execução automatizada desse tipo de comando mesmo após
regra de permissão adicionada). `server/setup-audit-log.mjs` também
corrigido, para que uma instalação nova já saia com a constraint
certa.

Depois da correção: `usuarios.test.js` + `fk-write-guards.test.js`
reexecutados isoladamente — **67/67 PASS**. Suíte completa
reexecutada do zero — **255/255 PASS, 0 FAIL**.

## 29. Testes (acumulado, final desta etapa)

Fase 5: 139 → 171 (Lote 1) → 176 (B7) → 189 (B8) → 203 (Lote 3) → 230
(Lote 4) → 232 (Lote 5) → **255/255 PASS, 0 FAIL** (+23: novos arquivos
`server/tests/audit-log.test.js` [B9] e `server/tests/
password-reset.test.js` [B14], mais os já contados do Lote 5).
`node --check`: 100% OK em todos os `.js`/`.mjs` de `server/` e todos
os `.js` de `public/src/` (verificação completa da árvore).
`inspect-db.mjs`: **24 tabelas** (23 anteriores + `AuditLog`, nova),
schema íntegro. `"User"` com as 2 colunas novas do B14
(`resetTokenHash`, `resetTokenExpiresAt`).

## 30. Validação real e visual (Lote 6)

Servidor Express real + Supabase real, admin temporário
`AUDIT-FASE5-LOTE6`:
- **B9**: criar usuário via `POST /api/usuarios` → registro em
  `"AuditLog"` confirmado (action=CREATE, ator correto, `after` sem
  `passwordHash`).
- **B14**: `POST /esqueci-senha` com conta existente e com conta
  inexistente → resposta HTTP idêntica nos dois casos (confirmado
  campo a campo); token gravado só como hash; `POST /redefinir-senha`
  com token válido → sucesso; sessão aberta ANTES do reset confirmada
  invalidada (`GET /auth/me` → `user: null`); reuso do mesmo token →
  400 "Link inválido ou expirado."; login com senha antiga → 401;
  login com senha nova → 200; ação registrada no `AuditLog` (B9
  aplicado ao B14).
- **Visual** (Browser real): tela de login → "Esqueci minha senha" →
  preencher e-mail → toast de confirmação (mensagem idêntica,
  anti-enumeração visível na UI); link de redefinição (capturado do
  log do servidor, já que `RESEND_API_KEY` não está configurada) →
  página `/redefinir-senha` renderizada corretamente, mesmo padrão
  visual do login → preencher nova senha → toast "Senha redefinida.
  Faça login com a nova senha." → volta à tela de login.

## 31. Limpeza e integridade (Lote 6)

Todo dado de teste (`AUDIT-FASE5-LOTE6*`) removido, incluindo os
registros de `AuditLog` gerados durante a validação — zero resíduo
confirmado por varredura completa nas 22 tabelas de dados. Também
localizados e removidos, durante o diagnóstico da regressão, 12
usuários de teste órfãos (`audit.fase2.*`/`audit.fase5.*`) e 3
registros órfãos (`Client`/`ProductService`/`Category`,
`AUDIT-FASE5-*`) deixados por execuções anteriores desta mesma janela
que foram interrompidas à força — confirmado, após a limpeza, que a
tabela `"User"` contém exatamente **1 registro**: o admin real
(`contato.atlazcompany@gmail.com`, `active=true`, `tokenVersion=0`,
`role=ADMIN`), nunca tocado. Nenhum segredo exposto: `.env`/
`.env.backup` confirmados fora do controle de versão
(`git check-ignore`), nenhuma chave de API hardcoded encontrada em
código (`RESEND_API_KEY` só é lida via `process.env`, nunca
gravada em arquivo versionado). Servidor de validação encerrado
(PID real via `netstat`/`taskkill`), porta 4000 livre.

## 32. Riscos restantes

B2, B3, B4, B5, B10, B18 seguem pendentes de decisão do consultor do
usuário — nada implementado, nada decidido por conta própria. B9 e
B14 implementados e validados nesta etapa. Nenhum P0, P1 ou P2 técnico
simples conhecido em aberto. B14 depende de uma decisão adicional do
usuário para ficar 100% operacional: provisionar `RESEND_API_KEY` em
produção (hoje em modo de desenvolvimento, sem enviar e-mail de
verdade — mitigado, como já era antes do B14, pela redefinição manual
via tela de Usuários).

## 33. Fechamento oficial do Lote 6 — auditoria independente ("fechar-fase")

O usuário formalizou um processo de fechamento de fase (`fechar-fase`):
nunca confiar cegamente em relatório anterior, mesmo que gerado pelo
próprio assistente — sempre reauditar do zero antes de declarar uma
fase concluída. Reexecutei toda a checagem de forma independente:

- **Achado de processo**: a primeira reexecução da suíte deu 137
  PASS / 11 SKIPPED ("sem conexão com o banco") — diagnosticado como
  contenção de conexão com o Supabase causada pelos MEUS PRÓPRIOS
  scripts de diagnóstico rodando em paralelo com a suíte (erro
  metodológico, não regressão). Reexecutada de forma isolada (nada
  mais tocando o banco) → **255/255 PASS, 0 FAIL**, repetível.
- **Lacuna na varredura de resíduo anterior**: a varredura usava uma
  lista de tabelas digitada à mão que esquecia `"Contact"` — corrigido
  usando `information_schema` para enumerar TODAS as tabelas e colunas
  de texto automaticamente, em vez de lista manual. Um "resíduo"
  aparente encontrado nessa nova varredura era só um estado
  transitório de um teste em execução no momento exato da consulta
  (confirmado ao reconsultar segundos depois — já limpo pelo próprio
  `after()` do teste); a varredura real, feita com o banco quieto,
  confirmou zero resíduo.
- **Segredos — achado real, sem risco residual**: 4 arquivos de log
  locais esquecidos em `/tmp` (de validações anteriores do B14, uma
  delas de antes desta rodada de fechamento) continham tokens de
  redefinição de senha em texto puro. Risco residual avaliado como
  zero — as contas de teste associadas já não existiam (confirmado
  pela varredura de resíduo). Todos apagados.
- **Ambiente**: confirmado que este projeto só tem produção (sem
  staging) — `server/.env` com uma única `DATABASE_URL`. Política já
  definida pelo usuário: aceitável nesta fase de desenvolvimento
  (sem clientes/usuários reais), sempre com conta de teste isolada +
  limpeza total, declarada a cada relatório sem precisar de nova
  pergunta a cada lote, com alerta automático se surgir sinal de uso
  real.
- Housekeeping: 4 scripts `temp-*.mjs` sem conteúdo sensível, soltos
  em `server/` desde antes desta sessão, removidos.

**Todos os critérios de avanço confirmados de forma independente →
Fase concluída e validada.**

## 34. Lote 7 — B22 (achado técnico novo, releitura pós-B9/B14)

Nova rodada de releitura (a pedido do usuário, sem item liberado
específico) focada no que B9/B14 adicionaram — encontrou 1 achado
técnico real:

**B22 (P2)** — em `usuarios.js`, `financeiro.js` e `contratos.js`, 9
das 11 rotas de escrita instrumentadas pelo B9 gravavam a operação
principal e o `logAudit()` como duas instruções SQL separadas (não
numa transação), contradizendo a própria recomendação técnica já
aprovada na proposta do B9 ("recomendação técnica: síncrona... na
mesma transação... para o log nunca perder um evento"). As 2 rotas que
já usavam `sql.begin` por outro motivo (marcar conta a receber/pagar
como recebida/paga) faziam isso corretamente, por acaso de reuso de
infraestrutura, não por decisão deliberada nas outras 9.

**Correção**: as 9 rotas (`usuarios.js`: POST /, PUT /:id, POST
/:id/redefinir-senha, DELETE /:id; `financeiro.js`: POST/DELETE
/receber, POST/DELETE /pagar; `contratos.js`: POST /, PUT /:id, DELETE
/:id) passaram a envolver a escrita principal + `logAudit(tx, ...)` no
mesmo `sql.begin(async (tx) => {...})` — mesmo padrão já usado em
`orcamentos.js` desde o Lote 1 e nas 2 rotas do `financeiro.js` que já
faziam certo. Nenhuma mudança de comportamento observável (mesmas
respostas HTTP, mesmos efeitos) — só a garantia de atomicidade.

**Testes**: suíte completa reexecutada, isolada — 255/255 PASS
(inalterado; as rotas afetadas já tinham cobertura em
`audit-log.test.js`, `fk-write-guards.test.js`, `usuarios.test.js`).
Não foi criado teste de "falha no meio da transação" (fault
injection) — mesma decisão já tomada para B20/B21: desproporcional
para o tamanho do achado; a garantia foi validada por revisão de
código e por confirmação funcional via HTTP real (abaixo).

**Validação HTTP real**: Contrato (criar/editar/excluir), Conta a
receber (criar/excluir) e Usuário (criar) via API real — confirmado
que cada operação gera exatamente o registro de `AuditLog`
correspondente (CREATE/UPDATE/DELETE), sem regressão funcional.

**Limpeza**: dados de validação removidos, zero resíduo confirmado nas
24 tabelas. Admin real intacto.

**Ambiguidades**: nenhuma — mesma classe de correção mecânica já usada
em B1/B19 (alinhar implementação a um padrão/design já aprovado, sem
tocar regra de negócio).

## 35. Lote 8 — B2, B3, B4, B5, B10, B18: consultor decidiu, implementado

O usuário trouxe as 6 decisões de regra de negócio que estavam
congeladas aguardando o consultor. Cada uma foi esclarecida com
perguntas pontuais antes de codificar (2 pontos ambíguos do B2, escopo
do B18, autorização de schema do B3), então implementada.

- **B2 — transição de status/estágio só avança.** Novo helper
  `assertValidTransition(current, next, { order, terminal })` em
  `server/utils.js` — sequência de avanço (pode pular etapas, nunca
  voltar) + saída definitiva (alcançável a qualquer momento antes do
  fim, sem volta depois dela). Aplicado em:
  - `eventos.js` (PUT /:id): RASCUNHO→...→REALIZADO→POS_EVENTO avança
    normalmente; CANCELADO é saída a qualquer momento até REALIZADO;
    POS_EVENTO e CANCELADO são definitivos.
  - `oportunidades.js` (PATCH /:id/estagio E PUT /:id — a mesma regra
    nos dois, pra PUT não virar uma brecha): PROSPECCAO→...→NEGOCIACAO
    avança; GANHO/PERDIDO são as duas saídas definitivas.
  - `orcamentos.js` (PUT /:id): RASCUNHO→ENVIADO avança;
    APROVADO/REJEITADO/EXPIRADO são saídas definitivas.
  - `contratos.js` (PUT /:id): RASCUNHO→ENVIADO→ASSINADO avança;
    CANCELADO é saída a qualquer momento; **ASSINADO agora é
    definitivo** — removeu a possibilidade que existia antes de
    "desassinar" voltando pra RASCUNHO.
- **B3 — documento (CPF/CNPJ) duplicado bloqueado.** Schema (aditivo,
  autorizado explicitamente): índice único CONDICIONAL em
  `"Client"."document"` (só quando não é nulo — vários clientes sem
  documento continuam permitidos). `clientes.js` POST/PUT capturam
  `23505` → 400 "Já existe um cliente com esse CPF/CNPJ."
- **B4 — Financeiro não aceita valor ≤ 0.** `financeiro.js` POST
  /receber e /pagar validam `amountCents > 0` antes de qualquer
  escrita.
- **B5 — desconto não pode passar do subtotal.** `orcamentos.js`:
  `assertDiscountWithinSubtotal()` calcula o subtotal a partir dos
  próprios itens sendo salvos e rejeita se o desconto for maior (igual
  ao subtotal é permitido — total zero, não negativo). Aplicado em
  POST e PUT.
- **B10 — decisão registrada, SEM alteração de código.** Usuário
  decidiu manter o valor do Contrato digitado manualmente (pode haver
  desconto negociado à parte do orçamento) — era exatamente o
  comportamento já existente.
- **B18 — marcador de "vigente" (Orçamento/Contrato), automático.**
  Schema (aditivo, autorizado): colunas `"vigente"` (boolean, default
  false) em `Budget` e `Contract`. Ao aprovar um Orçamento (status →
  APROVADO) ou assinar um Contrato (status → ASSINADO), `vigente` é
  gravado como `true` na MESMA transação que já existia (ou uma nova,
  no caso de `usuarios.js`/`clientes.js` que não tinham) e desmarca
  automaticamente (`vigente = false`) qualquer outro
  Orçamento/Contrato do MESMO evento — nunca mais de um vigente por
  vez. Sem `eventId`, não há grupo pra desmarcar (fica vigente
  sozinho).

**Schema aplicado** (`server/setup-status-rules.mjs`, idempotente,
aditivo): `Budget.vigente`, `Contract.vigente` (boolean not null
default false), índice único `Client_document_unique_idx` (condicional
a `document IS NOT NULL`). Confirmado via `inspect-db.mjs` — 24
tabelas (nenhuma nova, só colunas/índice), nenhum dado existente
tocado.

**Ambiguidades esclarecidas antes de codificar** (perguntas ao
usuário, não decididas sozinho): (1) Evento REALIZADO→POS_EVENTO
continua permitido (não é uma exceção à regra "só cancelado depois de
realizado" — POS_EVENTO é a etapa seguinte natural). (2) Contrato
ASSINADO passou a ser definitivo (só CANCELADO depois), removendo a
reversão pra RASCUNHO que o código antigo permitia. (3) B18 é
automático (não manual). (4) Autorização explícita para os 3 itens de
schema (B3 + B18 ×2).

## 36. Testes (acumulado, Lote 8)

Fase 5: ... → 255 (Lote 7) → **275/275 PASS, 0 FAIL** (+20, novo
arquivo `server/tests/regras-negocio-b2-b3-b4-b5-b18.test.js`, cobrindo
os 4 módulos do B2 — incluindo os casos-limite de cada estado
terminal —, duplicidade de documento do B3, valores inválidos do B4,
desconto igual/maior que o subtotal do B5, e o auto-desmarque do B18
em Orçamento e Contrato). Suíte completa reexecutada isolada (lição do
Lote 6/7: nunca com outro script tocando o banco em paralelo).
`node --check`: 100% OK em toda a árvore. `inspect-db.mjs`: 24 tabelas,
schema com as 2 colunas + 1 índice novos, nenhuma migration destrutiva.

## 37. Validação real e visual (Lote 8)

HTTP real: suíte de 20 testes já cobre todos os 6 achados via HTTP
real (não mockado). Validação visual adicional (Browser real, admin
temporário `AUDIT-FASE5-LOTE8-UI`): tela de "Novo orçamento" → cliente
selecionado, desconto de R$100 sem nenhum item (subtotal R$0) →
`POST /api/orcamentos` real (confirmado via rede) devolveu 400 "O
desconto não pode ser maior que o subtotal do orçamento." — o
formulário não navegou pra fora da tela (create rejeitado), confirmando
que o mecanismo de erro já existente no frontend (`toast(err.message)`)
segue funcionando sem nenhuma alteração de UI necessária.

## 38. Limpeza e integridade (Lote 8)

Todo dado de teste (`AUDIT-FASE5-LOTE8*`, `audit.fase5.lote8*`,
`AUDIT-FASE5-B2B18-*`) removido. Varredura exaustiva confirma **zero
resíduo** nas 24 tabelas. `"User"` com exatamente 1 registro — o admin
real, nunca tocado. Servidor de validação encerrado, porta 4000 livre.

## 39. Riscos restantes

**Nenhuma regra de negócio pendente de decisão** — B2, B3, B4, B5,
B10 e B18 foram todas decididas pelo usuário/consultor e implementadas
nesta etapa. Pendências restantes: B9 já implementado (nada pendente);
B14 aguarda `RESEND_API_KEY` (decisão/custo do usuário, opcional — o
sistema já funciona sem isso). Nenhum P0/P1/P2 técnico simples
conhecido.

## 40. Fechamento formal do Lote 8 via `/fechar-fase`

Criada a skill de verdade em `.claude/skills/fechar-fase/SKILL.md`
(antes só existia como texto passado em mensagem, sem arquivo
registrado). Reauditoria independente confirmou: **275/275 PASS**,
`node --check` limpo (78 arquivos), schema conferido (colunas
`vigente`, índice de documento, constraint do `AuditLog` — todos
corretos), zero resíduo (varredura via `information_schema`), admin
real intacto. Único achado: o admin real tinha um token de
redefinição de senha do teste do B14 ainda tecnicamente válido (nunca
exposto em log/arquivo — só existiu no e-mail real do próprio dono da
conta) — zerado a pedido do usuário logo em seguida.

`RESEND_API_KEY` provisionada pelo usuário e verificada (envio real
confirmado, 2 e-mails de teste entregues) — **B14 100% operacional**,
não é mais só modo desenvolvimento.

## 41. Releitura completa do backlog (a pedido do usuário)

Usuário pediu uma auditoria do zero de TODO o código, não só do que
mudou recentemente. Cobertura desta rodada: as 11 views de frontend
que ainda não tinham sido lidas por inteiro nesta auditoria (catálogo,
fornecedores, leads, operacional, funil/pipeline, usuários, financeiro,
contratos, dashboard, relatórios, `sued-wall.js`), mais
`server/supabaseClient.js`, `public/index.html`, e `npm audit` das
dependências (backend já tinha sido totalmente relido nos Lotes 5–8).

**Nenhum achado novo (sem B23).** Confirmado especificamente: RBAC
100% centralizado via `rolesForModule()` em todas as rotas (sem
hardcode divergente); zero vetor de `innerHTML`/XSS com dado dinâmico
fora do já corrigido no B20; nenhuma outra ocorrência do bug de
checkbox-fora-do-form (Lote 3) nas views ainda não lidas; todas as
exclusões destrutivas do frontend passam por `confirm()`;
`supabaseClient.js` com pool configurado adequadamente; `npm audit`:
**0 vulnerabilidades** em 91 dependências de produção; `index.html`
consistente com a CSP já configurada.

Terceira rodada de releitura completa desta Fase 5 (depois de achar
B19–B21, depois B22) — volume de achados chegando a zero é sinal de
estabilização, não de auditoria incompleta.

## 42. Checagem de performance/carga pré-lançamento (fora do backlog B1–B22)

Tarefa nova e separada, pedida antes do lançamento em produção (uso
esperado: 1–10 usuários simultâneos, sem staging). Não é achado B (não
é bug nem regra de negócio) — registrado aqui por afetar schema/config
de forma pequena e seguramente reversível, dentro da autorização já
dada pelo próprio pedido ("adicionar um índice... pode ser feita").

- **Queries dos endpoints mais usados**: nenhuma N+1 literal (nenhum
  loop de código fazendo 1 query por item) — os "custos por linha" são
  subconsultas correlacionadas dentro de uma ÚNICA instrução SQL
  (`orcamentos.js`, `clientes.js`, `catalogo.js`, `fornecedores.js`),
  que dependem de índice na coluna de FK usada no filtro.
- **Índices**: 19 de 32 colunas de FK sem índice próprio. Cruzado com
  o uso real (WHERE/subconsulta filtrada) nos endpoints citados —
  criados 6 índices novos (`server/setup-perf-indexes.mjs`, idempotente
  e aditivo): `Budget.eventId`, `Contract.eventId` (usados pelo
  auto-desmarque de "vigente" do B18 a cada aprovação/assinatura),
  `Checklist.eventId`, `ChecklistItem.checklistId`, `ScheduleItem.eventId`
  (painel Operacional, carregado a cada evento), `Event.eventTypeId`
  (contagem em `GET /tipos-evento`). Os outros 13 não são usados em
  filtro hoje — não indexados, para não indexar "por via das dúvidas".
- **Pool de conexão**: `max: 10` em `supabaseClient.js`. Medido:
  latência real por query ~150–260ms (dominada por RTT de rede até o
  Supabase, não processamento — tabelas ainda pequenas). Cálculo: 10
  conexões ÷ ~200ms/query ≈ 50 queries/s de capacidade. Pior caso
  realista (10 usuários clicando o Dashboard no mesmo instante = 50
  queries simultâneas, já que o Dashboard dispara 5 em paralelo) fica
  em fila e termina em ~1s — dentro do aceitável. **Suficiente para
  1–10 usuários com folga.**
- **Teste de carga leve**: 60s de carga sustentada (12 “usuários”
  virtuais, ritmo realista) + 3 rajadas de 15 requisições
  verdadeiramente simultâneas, contra produção, com admin temporário
  isolado (`AUDIT-FASE5-PERFTEST`, removido ao final). **Zero erros em
  680 requisições.** Tempo médio 445–623ms, p95 até ~2,2s em alguns
  casos, rajadas de 15 simultâneas resolvidas em <1s cada.
- **Memória**: 59,5 MB → 72,8 MB após a 1ª rodada (aquecimento do pool)
  → 74,0 MB após a 2ª rodada (+680 requisições adicionais) — practicamente
  estável entre as duas rodadas. **Sem sinal de vazamento.**
- **Paginação no frontend**: confirmado — nenhuma tela usa os
  parâmetros `page`/`pageSize` do B13. Toda listagem carrega a tabela
  inteira sempre. Não é problema com o volume atual, mas não escala
  se o volume de dados crescer — ficou registrado como observação, não
  corrigido nesta etapa (mudar isso é uma mudança de UX/comportamento
  visível em várias telas, fora do escopo de "correção pequena e
  seguramente reversível").

**Testes**: suíte completa reexecutada, isolada, após os 6 índices
novos — **275/275 PASS** (inalterado). `node --check`: 100% OK.

**Limpeza**: admin temporário e todo dado de teste removidos, zero
resíduo confirmado (24 tabelas). Admin real intacto. Servidor de
teste encerrado, porta 4000 livre.

## 44. Checklist de lançamento e deploy real

Levantamento pré-lançamento (fora do backlog B1–B22): variáveis de
ambiente obrigatórias, backup do Supabase, monitoramento, HTTPS/CORS/
CSP para o domínio real, credenciais com valor de dev, e processo de
rollback.

**Achado crítico encontrado e corrigido**: nada do projeto tinha sido
commitado no Git desde 18/07/2026 (só existia 1 commit inicial) — todo
o trabalho das Fases 2–5 (72+ arquivos) só existia no diretório local,
sem nenhuma forma de rollback. Corrigido: commit único (`ef2f9aa`)
abrangendo tudo, com `graphify-out/` (cache de ferramenta local, não é
parte do projeto) adicionado ao `.gitignore` antes de commitar. O
`origin` antigo (`GR-SUED/Sistema-da-SUED-CO`) não existia mais
(404) — usuário criou um repositório novo
(`AtlazCompany/Sistema-SUED`), remote atualizado e push confirmado (a
troca de `git remote set-url` foi bloqueada pelo classificador do
ambiente, executada pelo próprio usuário).

**Deploy real realizado** (Render, plano gratuito):
- Web Service criado a partir do repositório novo, Root Directory
  `server`, Build `npm install`.
- **Comando de start ajustado**: `npm start` usa
  `node --env-file=.env index.js` — confirmado por teste direto que o
  Node RECUSA iniciar se `.env` não existir (erro fatal, não um aviso).
  Como o Render injeta variáveis direto no processo (sem arquivo
  `.env`), o Start Command no painel do Render foi configurado como
  `node index.js` — nenhuma alteração no `package.json`/código, só
  configuração no painel.
- Variáveis configuradas no painel do Render: `DATABASE_URL`,
  `JWT_SECRET`, `RESEND_API_KEY` (mesmos valores do `.env` local),
  `NODE_ENV=production`, `APP_BASE_URL=https://sistema-sued.onrender.com`
  (domínio definido só depois da criação do serviço, adicionado depois
  — Render redeploya sozinho ao mudar uma variável).
- `PORT` não precisou ser configurada — `config.js` já lê
  `process.env.PORT`, e o Render injeta a sua própria automaticamente.

**Validação real do deploy**:
- `https://sistema-sued.onrender.com` → HTTP 200, título `SUED · ERP`
  confirmado (não é página de erro).
- Headers de segurança presentes (CSP, X-Frame-Options,
  X-Content-Type-Options); HTTPS confirmado via Cloudflare na frente
  do Render.
- **Conexão real com o Supabase confirmada em produção**: login com
  credencial inexistente → 401 "E-mail ou senha inválidos." (prova que
  o backend consultou o banco de verdade, não é erro de conexão).
- Fluxo de "esqueci senha" testado contra o deploy real (conta de
  teste temporária, removida ao final) — token gerado corretamente no
  banco. O texto exato do link não foi confirmado por e-mail real
  desta vez (endereço de teste usado não é um domínio válido para
  entrega) — usuário decidiu que a confirmação indireta já é
  suficiente (mesmo mecanismo de variável de ambiente já confirmado
  funcionando para `DATABASE_URL`/`JWT_SECRET`), sem exigir um novo
  teste com e-mail real.
- Observação: a chave `RESEND_API_KEY` já é usada para outros e-mails
  de negócio fora do SUED (visto no histórico da conta Resend) — não é
  um problema, só uma nota de contexto.
- Achado opcional, não corrigido: header `x-powered-by: Express`
  exposto (informação de framework, risco baixíssimo) — fica registrado
  para uma limpeza futura se quiserem.

**Itens do checklist original que ainda dependem do usuário** (não
resolvidos nesta etapa):
- **Backup automático do Supabase**: usuário ainda não confirmou o
  plano/retenção atual no painel do Supabase.
- **Monitoramento/alerta**: nenhum configurado; sugestão dada
  (UptimeRobot/Better Stack, gratuitos) mas não implementada — decisão
  do usuário.
- **`MAIL_FROM`**: continua usando o domínio de sandbox da Resend
  (`onboarding@resend.dev`) em vez de um domínio próprio verificado —
  funciona, mas não é a identidade de marca ideal para produção.

## 45. Backup manual (Supabase Free não inclui backup automático)

Usuário confirmou no painel do Supabase: **plano Free, sem backup
automático** ("Free Plan does not include project backups"). Decisão
do usuário: backup manual/script gratuito por enquanto, em vez de
upgrade pago imediato — decisão dele, não escolhida por mim.

`server/backup-db.mjs` (novo): exporta todas as linhas de todas as
tabelas do schema public para um JSON único e timestamped, em
`server/backups/` (já coberto por `.gitignore` — nunca commitado,
pode conter dado real de cliente). Testado contra produção — funciona.
Não é um backup formal (não é `pg_dump`, que não está instalado nesta
máquina), mas é suficiente pra recuperar dado se algo der errado, dado
o volume atual pequeno. Rodar manualmente antes de mudanças arriscadas
ou numa rotina periódica — não é automático.

**Achado real encontrado ao gerar o backup**: `"AuditLog"` tinha
**242 registros de resíduo de teste** dos Lotes 4–8 — nunca detectados
pelas varreduras de resíduo anteriores desta auditoria porque elas só
checavam colunas `text`/`character varying`, e `before`/`after` (onde
o resíduo estava) são `jsonb`. Confirmado com precisão que os 242 eram
100% resíduo (todos com `userId` nulo — só acontece quando o ator já
foi excluído; a única conta jamais excluída no projeto é o admin real,
que nunca aparece entre eles) — removidos. Backup regerado limpo (1
linha total: o admin real).

**Correção de metodologia**: `server/check-residue.mjs` (novo,
reutilizável) — mesma varredura de sempre, agora incluindo colunas
`jsonb`/`json`. Testado: zero resíduo confirmado nas 24 tabelas,
incluindo JSONB, depois da limpeza. Deve substituir os scripts
inline ad-hoc usados nos lotes anteriores para essa checagem.

**Reavaliação honesta**: os relatórios de "zero resíduo" dos Lotes
4 a 8 (CHECKPOINT.md, seções anteriores) estavam tecnicamente
incompletos nesse ponto específico — a conclusão final (zero resíduo)
continua verdadeira agora, mas não era garantida por aquelas
varreduras à época. Registrado aqui para transparência do histórico.

## 46. Próximo passo

Backlog B1–B22 e as 6 regras de negócio fechados; performance
validada; deploy real em produção (Render) confirmado funcionando,
com rollback via Git; backup manual disponível
(`server/backup-db.mjs`); resíduo histórico de `AuditLog` encontrado e
limpo; metodologia de varredura corrigida (`server/check-residue.mjs`).
Restam 2 itens que só o usuário pode decidir (monitoramento, domínio
de e-mail próprio) — nenhum bloqueia o uso atual. Parado aqui —
aguardando novo pedido do usuário.
