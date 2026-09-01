# CHECKPOINT — SUED SYSTEM — FASE 2

Gerado em pausa controlada (contexto ~80%). Este arquivo é a fonte de
verdade para retomar a Fase 2 numa nova janela sem perder decisões já
tomadas. Nada aqui foi inventado — só o que realmente foi executado e
observado nesta sessão.

> **ATUALIZAÇÃO (continuação desta mesma fase, sessão seguinte):** os
> itens P1 (ambos) e P2 (1, 2 e 4) descritos abaixo foram resolvidos e
> validados com testes reais — ver
> `audit/phase2/15-continuacao-p1-p2.txt` para o relato completo. Um
> achado NOVO, mais amplo que o P2-5 original, foi descoberto e
> deliberadamente NÃO corrigido naquele momento (decisão de arquitetura,
> não bug — ver seção 7 do relatório 15). As seções 5–10 abaixo foram
> deixadas como estavam no checkpoint anterior para preservar o
> histórico; o estado real e atual das pendências está no relatório 15
> e, para o item abaixo, no relatório 16.
>
> **ATUALIZAÇÃO 2 (mesma sessão de continuação, pedido explícito do
> usuário):** o achado "sessão não revalidada" descrito no relatório 15
> (seção 6) foi corrigido e validado — `requireAuth` agora recarrega
> `active`/`role`/nome/e-mail do banco a cada requisição, em vez de
> confiar no JWT antigo. Desativar, excluir ou trocar o papel de um
> usuário agora tem efeito imediato na próxima requisição dele, sem
> precisar de logout. Ver `audit/phase2/16-correcao-sessao-p1.txt` para
> o relato completo (problema, causa, solução, testes mockados + testes
> reais contra o servidor/banco real, resultado, riscos restantes).
> Testes: 107/107 → **116/116 PASS**.

---

## 1. O que da Fase 2 já foi auditado

- Schema real da tabela `"User"` (colunas, constraints, índices) — via
  `information_schema` real, não suposição.
- Fluxo completo de autenticação/segurança (bcrypt, JWT, cookies,
  expiração, logout, usuário inativo, enumeração de usuários, mensagens
  de erro, rate limit).
- Matriz RBAC completa — 5 papéis × 10 módulos (9 antigos + o novo
  "usuarios") — testada via **chamada HTTP real** contra o servidor e o
  banco reais, não só unitário.
- 4 fluxos de integração ponta-a-ponta reais, com IDs encadeados de
  verdade:
  - Comercial: Lead → Cliente → Oportunidade → Orçamento → Contrato →
    Evento
  - Operacional: Evento → Checklist → ChecklistItem → Task →
    ScheduleItem
  - Financeiro: Evento → Conta a pagar → Fornecedor; Evento → Conta a
    receber
  - Catálogo: ProductService → SupplierProduct → Supplier → BudgetItem
- Todos os módulos de negócio testados funcionalmente via API real:
  Dashboard, Leads, Clientes, Funil/Oportunidades, Eventos, Locais,
  Fornecedores, Catálogo, Orçamentos, Operacional, Financeiro,
  Contratos, Relatórios.
- Casos de erro propositais: UUID malformado, campo obrigatório
  ausente, estágio inválido, ID inexistente, data inválida, quantidade
  negativa.
- Banco de dados reconfirmado (23 tabelas, FKs, UNIQUE, sequences,
  índices) contra o que o código espera — nenhuma divergência nova além
  da já conhecida (User sem createdAt/updatedAt, reconfirmada na
  prática).
- Frontend testado de verdade no navegador (não só suposição): login,
  Dashboard, tela nova de Usuários (lista + modal criar + modal
  redefinir senha), Eventos, Financeiro, em 390px/1280px/1920px.
- Varredura final de segredos em código, Git, respostas HTTP e logs.
- `git status` / `git ls-files` / `git check-ignore` para `.env` e
  `.env.backup`.

## 2. O que já foi alterado (implementado nesta fase)

- **Gestão de usuários completa** (não existia antes desta fase):
  listar, criar, editar (nome/e-mail/papel/ativo), redefinir senha de
  outro usuário (ADMIN/SOCIO), excluir.
- **Troca da própria senha** (`PUT /api/auth/senha`), disponível a
  qualquer papel autenticado, com verificação da senha atual e
  reemissão do cookie da sessão atual.
- Regras de proteção: usuário não pode alterar o próprio papel nem se
  autodesativar/autoexcluir; trava de "não remover o último
  administrador/sócio ativo" (implementada, ver pendência P1 abaixo);
  e-mail duplicado → 409; papel inválido → 400; senha curta (<8) → 400;
  exclusão de usuário com vínculo (FK) → 409 amigável.
- **Decisão de RBAC documentada antes de implementar**: o novo módulo
  `"usuarios"` foi adicionado a `ALL_MODULES` em `public/src/roles.js`
  (não a uma lista separada), preservando a paridade ADMIN=SOCIO já
  existente em toda a matriz — nenhuma exceção nova foi criada.
- Item de menu "Usuários" + tela de gestão (`public/src/views/
  usuarios.js`) + botão "Alterar minha senha" no cabeçalho do shell.
- Testes automatizados novos/atualizados (ver seção 4).
- Ferramenta de auditoria `server/audit-phase2-run.mjs` (não faz parte
  do app — mesmo espírito de `inspect-db.mjs` já existente).
- 14 relatórios em `audit/phase2/*.txt` (01 a 14).

**Nada da Fase 1 foi revertido ou reescrito** — RBAC, numeração por
sequence, rate limit de login, headers de segurança e correção do menu
mobile foram todos **reconfirmados funcionando**, não refeitos.

## 3. Arquivos modificados/criados nesta fase

Backend:
- `server/auth.js` — modificado (+ `PUT /senha`)
- `server/routes/usuarios.js` — modificado (+ CRUD completo)
- `server/tests/rbac-matrix.test.js` — modificado (+ módulo "usuarios")
- `server/tests/usuarios.test.js` — **novo** (16 subtestes)
- `server/audit-phase2-run.mjs` — **novo** (ferramenta de auditoria)

Frontend:
- `public/src/roles.js` — modificado (+ "usuarios" em ALL_MODULES)
- `public/src/config.js` — modificado (+ item de menu)
- `public/src/auth.js` — modificado (+ `changePassword()`)
- `public/src/app.js` — modificado (+ rota `/usuarios`)
- `public/src/components/shell.js` — modificado (+ botão de senha)
- `public/src/views/usuarios.js` — **novo**

Relatórios:
- `audit/phase2/01-summary.txt` até `14-final-status.txt` — **novos**
  (14 arquivos, todos escritos e confirmados no disco)
- `audit/phase2/CHECKPOINT.md` — este arquivo

Todos os arquivos acima passaram em `node --check` (sintaxe válida),
confirmado nesta sessão.

## 4. Testes já executados e resultados

- `npm test` (suíte completa, `server/tests/*.test.js`): **97/97 PASS,
  0 FAIL** — executado 2 vezes nesta fase, resultado idêntico nas duas.
- Harness de auditoria funcional (`server/audit-phase2-run.mjs`) contra
  servidor + banco reais: **132/132 checagens PASS, 0 FAIL** (mais 12
  observações N/A, sem status pass/fail binário — documentadas nos
  relatórios).
  - Dentro disso: 51/51 checagens de RBAC real via HTTP (5 papéis × 10
    módulos + 1 checagem sem autenticação).
- `node --check` em todo `.js`/`.mjs` do backend e do frontend: **100%
  OK**.
- Teste real no navegador (Browser pane): login, navegação, tela de
  Usuários, Eventos, Financeiro, em 3 larguras — **zero erro de
  console, zero recurso bloqueado por CSP**.
- `inspect-db.mjs` reconfirmado: **23 tabelas presentes**, schema
  íntegro.
- `git ls-files | grep -i .env`: **vazio** (nenhum `.env` versionado).
- Varredura de segredos em código/Git/respostas HTTP/logs: **nenhum
  segredo exposto encontrado**.
- Confirmação final de banco: **User=1, todas as outras 22 tabelas=0**
  — idêntico ao estado do início da fase (dados de teste 100%
  removidos).

## 5. Problemas encontrados

1. Gestão de usuários e troca/reset de senha não existiam (pendência
   de fases anteriores).
2. UUID malformado em rota com `:id` devolve **500** em vez de 400
   (ex.: `GET /api/clientes/id-invalido`).
3. Data inválida em campo de evento devolve 500 com mensagem técnica
   do JS (`"Invalid time value"`) em vez de 400 amigável.
4. `auth.js` (login) faz `.toLowerCase()` no e-mail mas **não** faz
   `.trim()` — um e-mail colado com espaço nas pontas pode falhar
   erroneamente (achado por leitura de código, não testado ao vivo).
5. Sessões antigas (JWT já emitidos) não são revogadas na troca de
   senha — expiram naturalmente em até 8h (limitação arquitetural do
   JWT sem estado).
6. Modais empilham em vez de fechar o anterior ao abrir um novo
   (achado incidental durante teste manual no navegador).
7. Durante a própria auditoria: a primeira versão do script de limpeza
   do harness (`audit-phase2-run.mjs`) tinha ordem de FK incompleta
   (não previa que `BudgetItem` e `Interaction` são criados pelo
   backend sem devolver o id individual) e travou no meio, deixando
   resíduo temporário no banco. **Detectado imediatamente** (o processo
   terminou com erro, não silenciosamente), **corrigido** com limpeza
   manual de emergência (confirmada) e reescrita da lógica de limpeza
   por relacionamento/marca em vez de lista de ids — revalidado com
   sucesso total na execução seguinte.

## 6. Problemas corrigidos nesta fase

- Gestão de usuários (CRUD completo) — implementada e validada.
- Troca de senha própria — implementada e validada.
- Reset de senha por ADMIN/SOCIO — implementado e validado.
- Bug do próprio script de auditoria (ordem de limpeza de FK) —
  corrigido e revalidado (ver item 7 acima).

Os itens 2, 3, 4, 5, 6 da seção 5 **NÃO foram corrigidos** nesta fase —
foram registrados como pendências (ver seção 7), pois a instrução desta
pausa foi não continuar implementando.

## 7. Problemas ainda pendentes (classificados)

**P0 (bloqueador crítico): 0**

**P1 (importante, resolver antes de expor a múltiplos usuários reais):**
1. Trava de "último administrador/sócio ativo" implementada mas
   **não testada** contra o cenário real de "resta zero" (exigiria
   mexer na única conta admin de produção — evitado deliberadamente).
2. Resposta 409 de "excluir usuário vinculado" implementada mas
   **não testada** com um vínculo real (o usuário de teste excluído
   não tinha vínculos).

**P2 (deveria ser corrigido, não bloqueia):**
1. UUID malformado → 500 em vez de 400.
2. Data inválida em Evento → 500 com mensagem técnica em vez de 400.
3. Sessões antigas não revogadas na troca de senha (limitação
   arquitetural documentada).
4. Login sem `.trim()` no e-mail.

**P3 (qualidade de vida / futuro):**
1. Catálogos de apoio vazios (EventType, Venue, Category,
   ProductService, Supplier) — dado de negócio, não bug.
2. Modais empilham.
3. Nenhuma listagem tem paginação (herdado).
4. Recuperação de senha por e-mail (Opção C) não implementada —
   documentada como evolução futura, fora do escopo atual.
5. `Contact` sem nenhuma tela/rota de CRUD (herdado).
6. `Venue` sem rota PUT/editar (herdado).

## 8. O que ainda falta executar

A Fase 2, como solicitada originalmente, foi **concluída e entregue**
(relatório final já apresentado no terminal, 14 arquivos em
`audit/phase2/` escritos e confirmados). Este checkpoint é uma pausa
preventiva de contexto, não uma interrupção no meio de um trabalho
inacabado.

O que **não** foi feito, por ser trabalho de uma próxima fase (não
pedido nesta):
- Corrigir os itens P1/P2/P3 listados acima.
- Validar manualmente o cenário "último administrador" com um segundo
  admin de teste real.
- Validar manualmente a exclusão de usuário com vínculo real.
- Testar larguras intermediárias do frontend (375/430/768/1024/1440px)
  — só 390/1280/1920 foram testadas de fato.
- Abrir manualmente no navegador as telas que só foram testadas via
  API nesta fase (Leads, Clientes, Funil, Locais, Fornecedores,
  Catálogo, Orçamentos, Operacional, Contratos, Relatórios).

## 9. Próximo passo exato (quando a Fase 2/3 continuar)

Se o usuário pedir para **corrigir as pendências**: começar pelos 2
itens **P1** (validação real das travas de segurança de usuário), por
serem os únicos com risco de segurança/integridade ainda não
comprovado — não por serem falhas confirmadas, mas por não estarem
testadas contra o cenário real. Depois seguir para os P2 (400 em vez de
500 para entrada malformada; trim no e-mail do login).

Se o usuário pedir para **avançar para uma nova fase**: nenhuma ação de
preparação adicional é necessária — o sistema está no estado descrito
em `audit/phase2/14-final-status.txt` ("PRONTO PARA PRODUÇÃO, COM
RESSALVAS").

**Antes de qualquer nova alteração de código**, releia o estado atual
dos arquivos (não presuma a partir deste checkpoint) — esta é a mesma
regra que guiou toda a Fase 2.

## 10. Decisões técnicas importantes que não podem ser perdidas

- **SOCIO tem paridade total com ADMIN** em toda a matriz RBAC,
  incluindo o novo módulo "usuarios" — decisão deliberada, documentada,
  para manter consistência com o padrão já existente
  (`ROLE_MODULES.SOCIO === ROLE_MODULES.ADMIN` desde antes desta fase).
  Não criar exceções pontuais a isso sem nova justificativa explícita.
- **Só Opções A+B de senha foram implementadas** (admin redefine;
  usuário troca a própria) — Opção C (recuperação por e-mail) foi
  deliberadamente deixada de fora por exigir infraestrutura de e-mail
  transacional que não existe no projeto.
- **`"User"` não tem `createdAt`/`updatedAt`** — confirmado
  empiricamente nesta fase (tentativa de INSERT com essas colunas
  falhou). As rotas de criação de usuário desta fase já foram escritas
  sem elas. Não tentar adicioná-las via `prepInsert()` sem antes
  confirmar se uma migration de schema é realmente desejada.
- **Sequences `Budget_number_seq`/`Contract_number_seq`** (criadas na
  Fase 1) continuam a única fonte de numeração seura — não voltar para
  `count(*)+1`.
- **A limpeza de dados de teste em qualquer script futuro de auditoria
  deve ser por relacionamento/marca (LIKE no nome/e-mail + subqueries
  respeitando FK), nunca por lista de ids assumindo que todo id
  criado foi capturado** — a Fase 2 provou que isso é falso (BudgetItem
  e Interaction são criados pelo backend sem devolver o id ao
  chamador). Ver `server/audit-phase2-run.mjs` para o padrão correto já
  implementado e validado.
- **Ambiente Windows/Git Bash**: `node ... &` em background pode
  reportar um PID diferente do PID real do processo Windows — sempre
  confirmar com `netstat -ano | grep LISTENING` antes de usar
  `taskkill //F //PID`, senão o `kill` erra o alvo e um servidor zumbi
  com `.env` desatualizado continua respondendo (armadilha já
  encontrada e documentada na Fase 1, reconfirmada nesta sessão).
- **Este ambiente tem conectividade real com o Supabase de produção do
  projeto** — toda alteração/teste que grava no banco afeta o banco
  real. Sempre usar prefixo de teste identificável (nesta fase:
  `AUDIT-FASE2` / `audit.fase2.*`) e limpar ao final, confirmando por
  contagem, não por suposição.
- **Se mais de um arquivo de teste usar limpeza por `LIKE` num prefixo
  de e-mail compartilhado, arquivos rodando em paralelo (Node test
  runner roda `tests/*.test.js` concorrentemente) podem apagar a conta
  de bootstrap um do outro** — armadilha real, reproduzida e corrigida
  nesta sessão (ver `audit/phase2/15-continuacao-p1-p2.txt`, seção 7).
  Cada arquivo de teste que cria contas de admin de bootstrap deve usar
  um prefixo próprio (não apenas distinto como string, mas que não seja
  prefixo um do outro) e limpar por id específico, não por `LIKE`.

---

## 11. Continuação desta fase (sessão seguinte) — resumo rápido

Ver `audit/phase2/15-continuacao-p1-p2.txt` para o relato completo.
Resumo do que mudou desde a seção 10 acima:

**Resolvido e validado com teste real:**
- P1-1 (trava de último administrador): validada dentro do que é seguro
  testar contra um banco de produção real (sem forçar zero admins
  globais) — ver relatório 15, seção 1.
- P1-2 (excluir usuário vinculado): validada com FK real
  (`Event.commercialId`) — ver relatório 15, seção 2.
- P2-1 (UUID malformado → 500): corrigido, agora 400 "ID inválido."
  (`server/index.js`, erro Postgres `22P02`).
- P2-2 (data inválida em Evento/outros → 500): corrigido com
  `toDate`/`toDateOrNull` em `server/utils.js`, aplicado em 5 arquivos
  de rotas.
- P2-4 (login sem `.trim()` no e-mail): corrigido em `server/auth.js`.

**Descoberto nesta sessão e, a pedido explícito do usuário, CORRIGIDO
logo em seguida (não ficou pendente):**
- `requireAuth`/`requireRole` não revalidavam `active`/`role` contra o
  banco por requisição — um usuário desativado (ou com papel trocado)
  mantinha acesso total com o JWT antigo por até 8h. Corrigido:
  `requireAuth` agora recarrega o usuário do banco a cada requisição
  (fonte de verdade para `active`/`role`/nome/e-mail); `req.user` nunca
  mais vem direto do JWT. Efeito: desativação/exclusão/troca de papel
  passam a valer na próxima requisição do usuário afetado, sem logout.
  Detalhe completo — problema, causa, solução, testes mockados e testes
  reais contra servidor/banco real — em
  `audit/phase2/16-correcao-sessao-p1.txt`.

**Arquivos tocados nesta sessão** (além dos já listados na seção 3):
- `server/utils.js` — `toDateOrNull`/`toDate` (novo)
- `server/index.js` — mapeamento de erro `22P02` → 400
- `server/auth.js` — `.trim()` no e-mail do login; depois,
  `resolveSession()` (novo) + `requireAuth` (agora async, revalida
  contra o banco) + `GET /me` (usa `resolveSession`) — ver relatório 16
- `server/routes/eventos.js`, `orcamentos.js`, `oportunidades.js`,
  `financeiro.js`, `operacional.js` — `new Date()` → `toDate`/`toDateOrNull`
- `server/tests/usuarios.test.js` — 2 novos subtestes (P1); o subteste
  de "último administrador" foi depois redesenhado (3 admins de teste)
  por causa da correção de sessão — ver relatório 16
- `server/tests/auth-login.test.js` — 2 testes de trim; depois, +4
  testes de `GET /me` (relatório 16)
- `server/tests/middleware.test.js` — reescrito na correção de sessão
  para usar banco mockado (`mock.module`) — era síncrono e sem banco
- `server/tests/error-handling.test.js` — **novo arquivo** (4 testes)
- `audit/phase2/15-continuacao-p1-p2.txt` — **novo**
- `audit/phase2/16-correcao-sessao-p1.txt` — **novo**

**Testes:** 97/97 → 107/107 (P1/P2) → **116/116 PASS** (correção de
sessão). `node --check` 100% OK em todo `.js` de `server/` e `public/`.
`inspect-db.mjs`: 23 tabelas, schema íntegro. Banco confirmado limpo ao
final de cada etapa (zero resíduo de teste, admin real de produção
inalterado — `active=true`, papel inalterado).

**Riscos restantes (documentados, não bloqueadores — ver relatório 16
seção "riscos restantes"):**
1. Troca de senha não revoga sessões antigas de OUTROS
   dispositivos/abas (só a aba que trocou ganha cookie novo) — exigiria
   versionamento de token/blacklist, deliberadamente não implementado.
2. Se o Supabase ficar inacessível, toda rota autenticada passa a
   devolver 500 em vez de continuar validando só o JWT em memória —
   troca deliberada (mais seguro que assumir "ainda válido" sem banco).
3. TTL do JWT continua em 8h (não alterado) — deixou de ser um risco de
   acesso pós-desativação (já corrigido), mas ainda define por quanto
   tempo um cookie roubado seria aceito enquanto o usuário permanecer
   ativo — risco pré-existente, não introduzido por esta correção.

**Próximo passo, se o usuário quiser continuar:** os itens restantes são
os P3 (qualidade de vida) já listados na seção 7 acima — nenhum deles
bloqueador. Não há mais pendência P1 nem P2 conhecida em aberto.
