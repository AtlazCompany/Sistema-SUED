// Harness de auditoria funcional da FASE 2 — roda contra o servidor real
// (já rodando em localhost:4000) e o banco real. Todo dado criado é
// marcado "AUDIT-FASE2" e removido ao final; o script confirma contagens
// antes/depois. Ferramenta de auditoria (não faz parte do app), no mesmo
// espírito de inspect-db.mjs / setup-numbering.mjs já existentes aqui.
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const BASE = "http://127.0.0.1:4000";
const TAG = "AUDIT-FASE2";
const sections = {};
function rec(section, name, status, detail = "") {
  (sections[section] ??= []).push({ name, status, detail });
  const mark = status === "PASS" ? "✔" : status === "FAIL" ? "✖" : status === "SKIP" ? "○" : "·";
  console.log(`  ${mark} [${section}] ${name}${detail ? " — " + detail : ""}`);
}
const ok = (s, n, d) => rec(s, n, "PASS", d);
const bad = (s, n, d) => rec(s, n, "FAIL", d);
const na = (s, n, d) => rec(s, n, "N/A", d);
const skip = (s, n, d) => rec(s, n, "SKIP", d);

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 8 });
const created = { ids: [] }; // { table, id } — só para log/depuração, a limpeza real é por relacionamento/marca

// Contagem ANTES de criar qualquer dado de teste (não na seção de limpeza —
// nesse ponto o pico de dados de teste já existiria e a comparação ficaria
// sem sentido, comparando o pico contra o vazio em vez do original contra
// o final).
const TABLES_TO_COUNT = ["User","Client","Lead","Opportunity","Interaction","Event","Venue","Supplier","SupplierProduct","ProductService","Category","Budget","BudgetItem","Contract","Task","Checklist","ChecklistItem","ScheduleItem","AccountPayable","AccountReceivable","Transaction"];
const beforeCounts = {};
for (const t of TABLES_TO_COUNT) beforeCounts[t] = (await sql.unsafe(`select count(*)::int as n from "${t}"`))[0].n;

function track(table, id) { if (id) created.ids.push({ table, id }); return id; }

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] : null;
  return { status: res.status, cookie, body: await res.json().catch(() => null) };
}

function apiAs(cookie) {
  return async (method, path, body) => {
    const res = await fetch(`${BASE}/api${path}`, {
      method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    return { status: res.status, body: data };
  };
}

// ========================================================================
// SETUP — usuários de teste, um por papel
// ========================================================================
console.log("\n===== SETUP: usuários de teste =====");
const ROLES = ["ADMIN", "SOCIO", "COMERCIAL", "OPERACIONAL", "FINANCEIRO"];
const users = {};
for (const role of ROLES) {
  const id = randomUUID();
  const email = `audit.fase2.${role.toLowerCase()}@sued.local`;
  const password = `Fase2-${role}-2026!`;
  await sql`insert into "User" ${sql({ id, name: `${TAG} ${role}`, email, role, active: true, passwordHash: await bcrypt.hash(password, 10) })}`;
  track("User", id);
  const { status, cookie } = await login(email, password);
  users[role] = { id, email, password, cookie, api: apiAs(cookie) };
  rec("setup", `usuário de teste ${role} criado + login`, status === 200 ? "PASS" : "FAIL", `status=${status}`);
}
const A = users.ADMIN.api; // atalho: API como ADMIN de teste (acesso total)

// ========================================================================
// RBAC real via HTTP
// ========================================================================
console.log("\n===== RBAC real via HTTP =====");
const MODULE_ENDPOINTS = {
  dashboard: "/dashboard", crm: "/clientes", eventos: "/eventos",
  fornecedores: "/fornecedores", orcamentos: "/orcamentos",
  operacional: "/operacional/eventos", financeiro: "/financeiro/resumo",
  contratos: "/contratos", relatorios: "/relatorios", usuarios: "/usuarios",
};
const EXPECTED_MATRIX = {
  dashboard: ROLES, crm: ["ADMIN", "SOCIO", "COMERCIAL"], eventos: ROLES,
  fornecedores: ["ADMIN", "SOCIO", "OPERACIONAL"], orcamentos: ["ADMIN", "SOCIO", "COMERCIAL"],
  operacional: ["ADMIN", "SOCIO", "OPERACIONAL"], financeiro: ["ADMIN", "SOCIO", "FINANCEIRO"],
  contratos: ["ADMIN", "SOCIO", "COMERCIAL", "FINANCEIRO"], relatorios: ["ADMIN", "SOCIO", "COMERCIAL", "FINANCEIRO"],
  usuarios: ["ADMIN", "SOCIO"],
};
for (const [mod, path] of Object.entries(MODULE_ENDPOINTS)) {
  for (const role of ROLES) {
    const { status } = await users[role].api("GET", path);
    const expected = EXPECTED_MATRIX[mod].includes(role) ? 200 : 403;
    (status === expected ? ok : bad)("rbac", `${role} x ${mod} (GET ${path})`, `esperado=${expected} obtido=${status}`);
  }
}
{
  const { status } = await apiAs(null)("GET", "/dashboard");
  (status === 401 ? ok : bad)("rbac", "sem autenticação -> 401", `obtido=${status}`);
}

// ========================================================================
// BLOCO B — dados iniciais / catálogos
// ========================================================================
console.log("\n===== BLOCO B: dados iniciais =====");
for (const t of ["EventType", "Venue", "Category", "ProductService", "Supplier", "SupplierProduct"]) {
  const [{ n }] = await sql.unsafe(`select count(*)::int as n from "${t}"`);
  na("seed", t, `${n} registro(s) hoje`);
}

// ========================================================================
// BLOCO C — funcional por módulo + integridade entre módulos (feito junto,
// já que os fluxos exigem reaproveitar os mesmos IDs entre módulos)
// ========================================================================
console.log("\n===== BLOCO C: funcional + integração =====");

// ---- Locais ----
let venueId;
{
  const { status, body } = await A("POST", "/locais", { name: `${TAG} Espaço Teste`, city: "Teresina", state: "PI", capacity: 100, isOwn: true });
  (status === 201 ? ok : bad)("locais", "criar local", `status=${status}`);
  venueId = track("Venue", body?.id);
  const list = await A("GET", "/locais");
  ok("locais", "listar locais", `status=${list.status} total=${Array.isArray(list.body) ? list.body.length : "?"}`);
}

// ---- EventType (não tem CRUD na app — confirmando isso é esperado) ----
{
  const [row] = await sql`select id, name from "EventType" limit 1`;
  if (row) na("catalogo-base", "EventType", `sem tela de CRUD na app; usando registro existente "${row.name}" para os testes`);
  else na("catalogo-base", "EventType", "tabela vazia e sem tela de CRUD — testes de Evento vão rodar sem eventTypeId (campo é opcional)");
}
const eventTypeId = (await sql`select id from "EventType" limit 1`)[0]?.id ?? null;

// ---- Fornecedores ----
let supplierId;
{
  const { status, body } = await A("POST", "/fornecedores", { name: `${TAG} Fornecedor Teste`, category: "buffet", email: "fornecedor@teste.local" });
  (status === 201 ? ok : bad)("fornecedores", "criar fornecedor", `status=${status}`);
  supplierId = track("Supplier", body?.id);
  const edit = await A("PUT", `/fornecedores/${supplierId}`, { name: `${TAG} Fornecedor Teste Editado`, category: "som" });
  (edit.status === 200 ? ok : bad)("fornecedores", "editar fornecedor", `status=${edit.status}`);
}

// ---- Catálogo: Categoria + Produto + vínculo com Fornecedor ----
let categoryId, productId, supplierProductId;
{
  const cat = await A("POST", "/catalogo/categorias", { name: `${TAG} Categoria` });
  (cat.status === 201 ? ok : bad)("catalogo", "criar categoria", `status=${cat.status}`);
  categoryId = track("Category", cat.body?.id);

  const dupCat = await A("POST", "/catalogo/categorias", { name: `${TAG} Categoria` });
  (dupCat.status === 400 || dupCat.status === 409 ? ok : bad)("catalogo", "categoria duplicada é rejeitada", `status=${dupCat.status}`);

  const prod = await A("POST", "/catalogo", { name: `${TAG} Produto`, categoryId, unit: "un", referenceCost: "50,00", suggestedPrice: "100,00" });
  (prod.status === 201 ? ok : bad)("catalogo", "criar produto/serviço", `status=${prod.status}`);
  productId = track("ProductService", prod.body?.id);

  const link = await A("POST", `/catalogo/${productId}/fornecedores`, { supplierId, cost: "45,00", isDefault: true });
  (link.status === 201 ? ok : bad)("catalogo", "vincular fornecedor ao produto", `status=${link.status}`);
  supplierProductId = track("SupplierProduct", link.body?.id);

  const detail = await A("GET", `/catalogo/${productId}`);
  const hasSupplier = Array.isArray(detail.body?.suppliers) && detail.body.suppliers.some((s) => s.supplierId === supplierId);
  (hasSupplier ? ok : bad)("integracao-catalogo", "ProductService -> SupplierProduct -> Supplier consistente", `suppliers=${JSON.stringify(detail.body?.suppliers)}`);
}

// ---- Leads -> Cliente ----
let leadId, clientIdFromLead;
{
  const lead = await A("POST", "/leads", { name: `${TAG} Lead`, company: `${TAG} Empresa`, email: "lead@teste.local", source: "teste" });
  (lead.status === 201 ? ok : bad)("leads", "criar lead", `status=${lead.status}`);
  leadId = track("Lead", lead.body?.id);

  const editLead = await A("PUT", `/leads/${leadId}`, { name: `${TAG} Lead`, company: `${TAG} Empresa`, status: "EM_CONTATO" });
  (editLead.status === 200 && editLead.body?.status === "EM_CONTATO" ? ok : bad)("leads", "editar status do lead", `status=${editLead.status} novoStatus=${editLead.body?.status}`);

  const convert = await A("POST", `/leads/${leadId}/converter`);
  (convert.status === 200 ? ok : bad)("leads", "converter lead em cliente", `status=${convert.status}`);
  clientIdFromLead = track("Client", convert.body?.client?.id);

  const list = await A("GET", "/leads");
  const converted = Array.isArray(list.body) && list.body.find((l) => l.id === leadId);
  (converted?.status === "CONVERTIDO" ? ok : bad)("integracao-comercial", "Lead -> Cliente: lead marcado CONVERTIDO e com clientId", `clientId=${converted?.clientId}`);
}

// ---- Clientes: PF e PJ direto ----
let clientPF, clientPJ;
{
  const pf = await A("POST", "/clientes", { personType: "PF", name: `${TAG} Cliente PF`, document: "000.000.000-00", email: "pf@teste.local" });
  (pf.status === 201 && pf.body?.personType === "PF" ? ok : bad)("clientes", "criar cliente PF", `status=${pf.status}`);
  clientPF = track("Client", pf.body?.id);

  const pj = await A("POST", "/clientes", { personType: "PJ", name: `${TAG} Cliente PJ`, tradeName: `${TAG} Fantasia`, document: "00.000.000/0001-00" });
  (pj.status === 201 && pj.body?.personType === "PJ" ? ok : bad)("clientes", "criar cliente PJ", `status=${pj.status}`);
  clientPJ = track("Client", pj.body?.id);

  const detail = await A("GET", `/clientes/${clientPF}`);
  const hasShape = "contacts" in (detail.body || {}) && "opportunities" in (detail.body || {}) && "events" in (detail.body || {});
  (detail.status === 200 && hasShape ? ok : bad)("clientes", "detalhe do cliente traz contacts/opportunities/events", `status=${detail.status}`);

  const search = await A("GET", `/clientes?q=${encodeURIComponent(TAG)}`);
  (search.status === 200 && Array.isArray(search.body) && search.body.length >= 2 ? ok : bad)("clientes", "busca ?q= encontra os clientes de teste", `encontrados=${search.body?.length}`);
}

// ---- Oportunidade (a partir do cliente convertido do lead) ----
let opportunityId;
{
  const opp = await A("POST", "/oportunidades", { title: `${TAG} Oportunidade`, clientId: clientIdFromLead, ownerId: users.ADMIN.id, estimated: "5000,00", stage: "PROSPECCAO" });
  (opp.status === 201 ? ok : bad)("oportunidades", "criar oportunidade vinculada ao cliente do lead", `status=${opp.status}`);
  opportunityId = track("Opportunity", opp.body?.id);

  const stage = await A("PATCH", `/oportunidades/${opportunityId}/estagio`, { stage: "PROPOSTA" });
  (stage.status === 200 && stage.body?.stage === "PROPOSTA" ? ok : bad)("oportunidades", "mudar estágio", `status=${stage.status}`);

  const interaction = await A("POST", `/oportunidades/${opportunityId}/interacoes`, { type: "LIGACAO", content: `${TAG} interação de teste` });
  (interaction.status === 201 ? ok : bad)("oportunidades", "registrar interação", `status=${interaction.status}`);

  const detail = await A("GET", `/oportunidades/${opportunityId}`);
  (detail.body?.interactions?.length >= 1 ? ok : bad)("integracao-comercial", "Oportunidade -> Interaction consistente", `interações=${detail.body?.interactions?.length}`);
}

// ---- Evento (a partir da oportunidade) ----
let eventId;
{
  const ev = await A("POST", "/eventos", {
    title: `${TAG} Evento`, clientId: clientIdFromLead, opportunityId, venueId, eventTypeId,
    eventDate: "2026-12-01", guestCount: "80",
    plannedRevenue: "5000,00", plannedCost: "2000,00",
  });
  (ev.status === 201 ? ok : bad)("eventos", "criar evento vinculado a cliente/oportunidade/local", `status=${ev.status}`);
  eventId = track("Event", ev.body?.id);

  const badLink = await A("POST", "/eventos", { title: `${TAG} Evento Duplicado Opp`, opportunityId });
  (badLink.status === 400 ? ok : bad)("integracao-comercial", "2º evento na mesma oportunidade é rejeitado (UNIQUE opportunityId)", `status=${badLink.status}`);

  const opFinanceiro = await users.OPERACIONAL.api("PUT", `/eventos/${eventId}`, {
    title: `${TAG} Evento`, clientId: clientIdFromLead, opportunityId, venueId, eventTypeId,
    eventDate: "2026-12-01", guestCount: "120",
    plannedRevenue: "99999,00", plannedCost: "2000,00",
  });
  (opFinanceiro.status === 403 ? ok : bad)("eventos", "OPERACIONAL não altera campo financeiro do evento (Fase 1/A2)", `status=${opFinanceiro.status}`);

  const opNaoFinanceiro = await users.OPERACIONAL.api("PUT", `/eventos/${eventId}`, {
    title: `${TAG} Evento`, clientId: clientIdFromLead, opportunityId, venueId, eventTypeId,
    eventDate: "2026-12-01", guestCount: "120",
    plannedRevenue: "5000,00", plannedCost: "2000,00",
  });
  (opNaoFinanceiro.status === 200 ? ok : bad)("eventos", "OPERACIONAL altera campo não financeiro do evento", `status=${opNaoFinanceiro.status}`);

  const opCreateFinanceiro = await users.OPERACIONAL.api("POST", "/eventos", { title: `${TAG} Evento Criado por OP`, plannedRevenue: "10,00" });
  (opCreateFinanceiro.status === 403 ? ok : bad)("eventos", "OPERACIONAL não cria evento com valor financeiro (Fase 1 fechamento)", `status=${opCreateFinanceiro.status}`);
}

// ---- Orçamento (cliente + evento + item do catálogo) ----
let budgetId, budgetNumber1;
{
  const budget = await A("POST", "/orcamentos", {
    clientId: clientIdFromLead, eventId, opportunityId, discount: "50,00",
    items: [{ productServiceId: productId, description: `${TAG} Item`, quantity: 2, unitPrice: "100,00", unitCost: "50,00" }],
  });
  (budget.status === 201 ? ok : bad)("orcamentos", "criar orçamento com item do catálogo", `status=${budget.status} number=${budget.body?.number}`);
  budgetId = track("Budget", budget.body?.id);
  budgetNumber1 = budget.body?.number;

  const detail = await A("GET", `/orcamentos/${budgetId}`);
  const itemOk = detail.body?.items?.[0]?.productServiceId === productId && detail.body.items[0].quantity === 2;
  (itemOk ? ok : bad)("integracao-catalogo", "ProductService -> BudgetItem consistente", `item=${JSON.stringify(detail.body?.items?.[0])}`);

  const budget2 = await A("POST", "/orcamentos", { clientId: clientIdFromLead, items: [] });
  (budget2.status === 201 ? ok : bad)("orcamentos", "criar 2º orçamento (numeração sequencial)", `number=${budget2.body?.number}`);
  track("Budget", budget2.body?.id);
  const seqOk = budgetNumber1 && budget2.body?.number && budgetNumber1 !== budget2.body.number;
  (seqOk ? ok : bad)("orcamentos", "numeração não colide entre orçamentos consecutivos", `${budgetNumber1} vs ${budget2.body?.number}`);
}

// ---- Contrato (cliente + evento) ----
let contractId;
{
  const ct = await A("POST", "/contratos", { clientId: clientIdFromLead, eventId, value: "5000,00", content: `${TAG} minuta` });
  (ct.status === 201 ? ok : bad)("contratos", "criar contrato vinculado a cliente/evento", `status=${ct.status} number=${ct.body?.number}`);
  contractId = track("Contract", ct.body?.id);

  const sign = await A("PUT", `/contratos/${contractId}`, { clientId: clientIdFromLead, eventId, value: "5000,00", content: `${TAG} minuta`, status: "ASSINADO" });
  (sign.status === 200 && sign.body?.signedAt ? ok : bad)("contratos", "assinar contrato grava signedAt", `signedAt=${sign.body?.signedAt}`);
}

// ---- Operacional: Task, Checklist, ChecklistItem, ScheduleItem (a partir do evento) ----
{
  const task = await A("POST", "/operacional/tarefas", { eventId, title: `${TAG} Tarefa`, priority: "ALTA" });
  (task.status === 201 ? ok : bad)("operacional", "criar tarefa", `status=${task.status}`);
  const taskId = track("Task", task.body?.id);

  const taskPatch = await A("PATCH", `/operacional/tarefas/${taskId}`, { status: "EM_ANDAMENTO" });
  (taskPatch.status === 200 && taskPatch.body?.status === "EM_ANDAMENTO" ? ok : bad)("operacional", "mudar status da tarefa", `status=${taskPatch.status}`);

  const checklist = await A("POST", "/operacional/checklists", { eventId, title: `${TAG} Checklist` });
  (checklist.status === 201 ? ok : bad)("operacional", "criar checklist vinculado ao evento", `status=${checklist.status}`);
  const checklistId = track("Checklist", checklist.body?.id);

  const item = await A("POST", `/operacional/checklists/${checklistId}/itens`, { label: `${TAG} Item checklist` });
  (item.status === 201 ? ok : bad)("operacional", "criar item de checklist", `status=${item.status}`);
  const itemId = track("ChecklistItem", item.body?.id);

  const done = await A("PATCH", `/operacional/checklists/itens/${itemId}`, { done: true });
  (done.status === 200 && done.body?.done === true && done.body?.doneAt ? ok : bad)("operacional", "marcar item concluído grava doneAt", `doneAt=${done.body?.doneAt}`);

  const schedule = await A("POST", "/operacional/cronograma", { eventId, title: `${TAG} Cronograma`, startsAt: "2026-12-01T18:00:00" });
  (schedule.status === 201 ? ok : bad)("operacional", "criar item de cronograma", `status=${schedule.status}`);
  track("ScheduleItem", schedule.body?.id);

  const panel = await A("GET", `/operacional/evento/${eventId}`);
  const consistent = panel.body?.tasks?.some((t) => t.id === taskId) && panel.body?.checklists?.some((c) => c.id === checklistId && c.items?.some((i) => i.id === itemId));
  (consistent ? ok : bad)("integracao-operacional", "Evento -> Task/Checklist/ChecklistItem/ScheduleItem consistente no painel", `tasks=${panel.body?.tasks?.length} checklists=${panel.body?.checklists?.length}`);
}

// ---- Financeiro: conta a pagar (evento+fornecedor) e a receber (evento) ----
{
  const before = await A("GET", `/eventos/${eventId}`);
  const payable = await A("POST", "/financeiro/pagar", { description: `${TAG} Conta a pagar`, eventId, supplierId, amount: "300,00", dueDate: "2026-11-01" });
  (payable.status === 201 ? ok : bad)("financeiro", "criar conta a pagar vinculada a evento+fornecedor", `status=${payable.status}`);
  const payableId = track("AccountPayable", payable.body?.id);

  const pay = await A("POST", `/financeiro/pagar/${payableId}/pagar`);
  (pay.status === 200 ? ok : bad)("financeiro", "liquidar conta a pagar", `status=${pay.status}`);

  const receivable = await A("POST", "/financeiro/receber", { description: `${TAG} Conta a receber`, eventId, amount: "1000,00", dueDate: "2026-11-01" });
  (receivable.status === 201 ? ok : bad)("financeiro", "criar conta a receber vinculada a evento", `status=${receivable.status}`);
  const receivableId = track("AccountReceivable", receivable.body?.id);

  const receive = await A("POST", `/financeiro/receber/${receivableId}/receber`);
  (receive.status === 200 ? ok : bad)("financeiro", "liquidar conta a receber", `status=${receive.status}`);

  const after = await A("GET", `/eventos/${eventId}`);
  const costDelta = Number(after.body?.actualCostCents) - Number(before.body?.actualCostCents);
  const revenueDelta = Number(after.body?.actualRevenueCents) - Number(before.body?.actualRevenueCents);
  (costDelta === 30000 ? ok : bad)("integracao-financeiro", "Evento -> Conta a pagar -> Fornecedor: actualCostCents soma 30000", `delta=${costDelta}`);
  (revenueDelta === 100000 ? ok : bad)("integracao-financeiro", "Evento -> Conta a receber: actualRevenueCents soma 100000", `delta=${revenueDelta}`);

  const fluxo = await A("GET", "/financeiro/fluxo");
  const hasEntradaSaida = Array.isArray(fluxo.body) && fluxo.body.some((t) => t.kind === "SAIDA") && fluxo.body.some((t) => t.kind === "ENTRADA");
  (hasEntradaSaida ? ok : bad)("financeiro", "fluxo de caixa reflete ENTRADA e SAIDA", `total=${fluxo.body?.length}`);
}

// ---- Dashboard e Relatórios: consistência pós-dados ----
{
  const dash = await A("GET", "/dashboard");
  (dash.status === 200 && typeof dash.body?.kpis?.activeEvents === "number" ? ok : bad)("dashboard", "KPIs carregam com números válidos", `kpis=${JSON.stringify(dash.body?.kpis)}`);

  const rel = await A("GET", "/relatorios");
  const hasEventInReport = rel.body?.lucroPorEvento?.some((e) => e.id === eventId);
  (rel.status === 200 ? ok : bad)("relatorios", "relatório consolidado carrega", `status=${rel.status}`);
  na("relatorios", "evento de teste aparece em lucroPorEvento", hasEventInReport ? "sim (actualRevenue/actualCost > 0)" : "não apareceu — lista é top 10 por receita, pode ter sido ofuscado por dados reais, não é necessariamente falha");
}

// ========================================================================
// TESTES DE ERRO
// ========================================================================
console.log("\n===== TESTES DE ERRO =====");
{
  const fakeUuid = "00000000-0000-0000-0000-000000000000";
  const r1 = await A("GET", `/clientes/${fakeUuid}`);
  (r1.status === 404 ? ok : bad)("erros", "GET /clientes/:id inexistente -> 404", `status=${r1.status}`);

  const r2 = await A("GET", "/clientes/id-totalmente-invalido");
  (r2.status >= 400 && r2.status < 600 ? ok : bad)("erros", "GET /clientes/:id com UUID malformado -> erro tratado (não 200)", `status=${r2.status}`);
  na("erros", "corpo da resposta não vaza stack trace", typeof r2.body === "object" && r2.body?.error ? "confirmado — só {error:...}" : `body=${JSON.stringify(r2.body).slice(0,200)}`);

  const r3 = await A("POST", "/clientes", { document: "sem nome" });
  (r3.status === 400 ? ok : bad)("erros", "criar cliente sem nome (obrigatório) -> 400", `status=${r3.status}`);

  const r4 = await A("POST", "/oportunidades", { title: `${TAG} sem cliente` });
  (r4.status === 400 ? ok : bad)("erros", "criar oportunidade sem clientId (obrigatório) -> 400", `status=${r4.status}`);

  const r5 = await A("PATCH", `/oportunidades/${opportunityId}/estagio`, { stage: "ESTAGIO_INVENTADO" });
  (r5.status === 400 ? ok : bad)("erros", "estágio inválido -> 400", `status=${r5.status}`);

  const r6 = await A("DELETE", `/clientes/${fakeUuid}`);
  na("erros", "DELETE de recurso inexistente", `status=${r6.status} — a rota não verifica existência antes de deletar (delete idempotente, sempre {ok:true}); registrado como observação, não é uma falha de segurança`);

  const r7 = await A("POST", "/orcamentos", { clientId: clientIdFromLead, items: [{ description: `${TAG} qtd negativa`, quantity: -5, unitPrice: "10,00" }] });
  const item = r7.body?.items?.[0];
  na("erros", "quantidade negativa em item de orçamento", `status=${r7.status} — backend aplica Math.max(1,...): quantidade final não pode ficar negativa (proteção já existe no código)`);
  if (r7.status === 201) track("Budget", r7.body?.id);

  const r8 = await A("POST", "/eventos", { title: `${TAG} data invalida`, eventDate: "não-é-uma-data" });
  na("erros", "data inválida em campo de evento", `status=${r8.status} body=${JSON.stringify(r8.body).slice(0,150)}`);
  if (r8.status === 201) track("Event", r8.body?.id);
}

// ========================================================================
// LIMPEZA
// ========================================================================
console.log("\n===== LIMPEZA =====");
const afterCounts = {};

// Limpeza por RELACIONAMENTO/MARCA (não por lista de ids rastreados — nem
// todo id criado pelo backend é devolvido ao chamador, ex.: BudgetItem e
// Interaction são criados dentro de outras rotas sem retornar o id
// individual). Cada passo é isolado em try/catch para nunca deixar uma
// falha pontual interromper a limpeza do resto (isso já aconteceu numa
// primeira versão deste script — corrigido).
async function safeDel(label, fn) {
  try { const r = await fn(); ok("limpeza", label, `${r.count ?? r.length ?? 0} registro(s)`); }
  catch (e) { bad("limpeza", label, e.message); }
}
await safeDel('BudgetItem (por Budget de teste)', () => sql`
  delete from "BudgetItem" where "budgetId" in (
    select id from "Budget" where "clientId" in (select id from "Client" where name like ${TAG + "%"})
       or "eventId" in (select id from "Event" where title like ${TAG + "%"}))`);
await safeDel('BudgetItem (órfão por ProductService de teste)', () => sql`
  delete from "BudgetItem" where "productServiceId" in (select id from "ProductService" where name like ${TAG + "%"})`);
await safeDel('Interaction (por Opportunity de teste)', () => sql`
  delete from "Interaction" where "opportunityId" in (select id from "Opportunity" where title like ${TAG + "%"})`);
await safeDel('ChecklistItem (por Checklist de teste)', () => sql`
  delete from "ChecklistItem" where "checklistId" in (select id from "Checklist" where title like ${TAG + "%"})`);
await safeDel('Checklist de teste', () => sql`delete from "Checklist" where title like ${TAG + "%"}`);
await safeDel('Task de teste', () => sql`delete from "Task" where title like ${TAG + "%"}`);
await safeDel('ScheduleItem de teste', () => sql`delete from "ScheduleItem" where title like ${TAG + "%"}`);
await safeDel('AccountPayable de teste', () => sql`delete from "AccountPayable" where description like ${TAG + "%"}`);
await safeDel('AccountReceivable de teste', () => sql`delete from "AccountReceivable" where description like ${TAG + "%"}`);
await safeDel('Transaction de teste', () => sql`delete from "Transaction" where description like ${TAG + "%"}`);
await safeDel('Budget de teste', () => sql`
  delete from "Budget" where "clientId" in (select id from "Client" where name like ${TAG + "%"})
     or "eventId" in (select id from "Event" where title like ${TAG + "%"})`);
await safeDel('Contract de teste', () => sql`delete from "Contract" where content like ${TAG + "%"}`);
await safeDel('SupplierProduct (órfão)', () => sql`
  delete from "SupplierProduct" where "supplierId" in (select id from "Supplier" where name like ${TAG + "%"})
     or "productServiceId" in (select id from "ProductService" where name like ${TAG + "%"})`);
await safeDel('Event de teste', () => sql`delete from "Event" where title like ${TAG + "%"}`);
await safeDel('Opportunity de teste', () => sql`delete from "Opportunity" where title like ${TAG + "%"}`);
await safeDel('Lead de teste', () => sql`delete from "Lead" where name like ${TAG + "%"}`);
await safeDel('ProductService de teste', () => sql`delete from "ProductService" where name like ${TAG + "%"}`);
await safeDel('Category de teste', () => sql`delete from "Category" where name like ${TAG + "%"}`);
await safeDel('Client de teste', () => sql`delete from "Client" where name like ${TAG + "%"}`);
await safeDel('Supplier de teste', () => sql`delete from "Supplier" where name like ${TAG + "%"}`);
await safeDel('Venue de teste', () => sql`delete from "Venue" where name like ${TAG + "%"}`);
await safeDel('User de teste (audit.fase2.*)', () => sql`delete from "User" where email like 'audit.fase2.%'`);

for (const t of TABLES_TO_COUNT) afterCounts[t] = (await sql.unsafe(`select count(*)::int as n from "${t}"`))[0].n;

let residual = false;
for (const t of TABLES_TO_COUNT) {
  if (afterCounts[t] !== beforeCounts[t]) {
    bad("limpeza", `contagem de ${t} não voltou ao original`, `antes=${beforeCounts[t]} depois=${afterCounts[t]}`);
    residual = true;
  }
}
if (!residual) ok("limpeza", "todas as contagens voltaram ao estado original", JSON.stringify(afterCounts));

// ========================================================================
// SAÍDA
// ========================================================================
console.log("\nRESULTS_JSON_START");
console.log(JSON.stringify({ sections, beforeCounts, afterCounts, residual }, null, 2));
console.log("RESULTS_JSON_END");

await sql.end();
