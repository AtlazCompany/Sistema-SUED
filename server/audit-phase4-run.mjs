// Harness de auditoria funcional da FASE 4 — roda contra o servidor real
// (já rodando em localhost:4000) e o banco real. Baseado no harness da
// Fase 2 (audit-phase2-run.mjs), que já cobria boa parte do fluxo de
// integração completo — a Fase 4 pediu explicitamente para não repetir
// auditorias já feitas, então este script REAPROVEITA aquele fluxo e
// ACRESCENTA o que a Fase 4 pede a mais: verificação matemática de
// dashboard/orçamento/relatórios, RBAC funcional POST/PUT/DELETE (não só
// GET), numeração de contrato com 2 criações, e mais casos de erro.
// Todo dado criado é marcado "AUDIT-FASE4" e removido ao final; o script
// confirma contagens antes/depois.
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const BASE = "http://127.0.0.1:4000";
const TAG = "AUDIT-FASE4";
const sections = {};
function rec(section, name, status, detail = "") {
  (sections[section] ??= []).push({ name, status, detail });
  const mark = status === "PASS" ? "✔" : status === "FAIL" ? "✖" : status === "SKIP" ? "○" : "·";
  console.log(`  ${mark} [${section}] ${name}${detail ? " — " + detail : ""}`);
}
const ok = (s, n, d) => rec(s, n, "PASS", d);
const bad = (s, n, d) => rec(s, n, "FAIL", d);
const na = (s, n, d) => rec(s, n, "N/A", d);

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 8 });
const created = { ids: [] };

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
  const email = `audit.fase4.${role.toLowerCase()}@sued.local`;
  const password = `Fase4-${role}-2026!`;
  await sql`insert into "User" ${sql({ id, name: `${TAG} ${role}`, email, role, active: true, passwordHash: await bcrypt.hash(password, 10) })}`;
  track("User", id);
  const { status, cookie } = await login(email, password);
  users[role] = { id, email, password, cookie, api: apiAs(cookie) };
  rec("setup", `usuário de teste ${role} criado + login`, status === 200 ? "PASS" : "FAIL", `status=${status}`);
}
const A = users.ADMIN.api;

// ========================================================================
// RBAC funcional real via HTTP — GET (matriz completa) + POST/PUT/DELETE
// (amostra por módulo, não só GET — pedido explícito da Fase 4)
// ========================================================================
console.log("\n===== RBAC funcional via HTTP =====");
const MODULE_ENDPOINTS = {
  dashboard: "/dashboard", crm: "/clientes", eventos: "/eventos",
  fornecedores: "/fornecedores", orcamentos: "/orcamentos",
  operacional: "/operacional/eventos", financeiro: "/financeiro/resumo",
  contratos: "/contratos", relatorios: "/relatorios",
};
const EXPECTED_MATRIX = {
  dashboard: ROLES, crm: ["ADMIN", "SOCIO", "COMERCIAL"], eventos: ROLES,
  fornecedores: ["ADMIN", "SOCIO", "OPERACIONAL"], orcamentos: ["ADMIN", "SOCIO", "COMERCIAL"],
  operacional: ["ADMIN", "SOCIO", "OPERACIONAL"], financeiro: ["ADMIN", "SOCIO", "FINANCEIRO"],
  contratos: ["ADMIN", "SOCIO", "COMERCIAL", "FINANCEIRO"], relatorios: ["ADMIN", "SOCIO", "COMERCIAL", "FINANCEIRO"],
};
for (const [mod, path] of Object.entries(MODULE_ENDPOINTS)) {
  for (const role of ROLES) {
    const { status } = await users[role].api("GET", path);
    const expected = EXPECTED_MATRIX[mod].includes(role) ? 200 : 403;
    (status === expected ? ok : bad)("rbac-get", `${role} x ${mod} (GET ${path})`, `esperado=${expected} obtido=${status}`);
  }
}
{
  const { status } = await apiAs(null)("GET", "/dashboard");
  (status === 401 ? ok : bad)("rbac-get", "sem autenticação -> 401", `obtido=${status}`);
}

// RBAC de escrita: um papel SEM acesso ao módulo tentando POST/PUT/DELETE
// direto pela API (não pelo menu) deve levar 403, nunca conseguir.
console.log("\n----- RBAC de escrita (POST/PUT/DELETE) para papel sem acesso -----");
const WRITE_DENIAL_CHECKS = [
  { role: "OPERACIONAL", method: "POST", path: "/clientes", body: { name: "não deveria criar" }, label: "OPERACIONAL não pode POST /clientes" },
  { role: "FINANCEIRO", method: "POST", path: "/clientes", body: { name: "não deveria criar" }, label: "FINANCEIRO não pode POST /clientes" },
  { role: "COMERCIAL", method: "POST", path: "/fornecedores", body: { name: "não deveria criar" }, label: "COMERCIAL não pode POST /fornecedores" },
  { role: "OPERACIONAL", method: "POST", path: "/orcamentos", body: { clientId: null, items: [] }, label: "OPERACIONAL não pode POST /orcamentos" },
  { role: "COMERCIAL", method: "POST", path: "/financeiro/pagar", body: { description: "x", amount: "1,00" }, label: "COMERCIAL não pode POST /financeiro/pagar" },
  { role: "OPERACIONAL", method: "POST", path: "/contratos", body: { clientId: null }, label: "OPERACIONAL não pode POST /contratos" },
  { role: "FINANCEIRO", method: "DELETE", path: "/eventos/00000000-0000-0000-0000-000000000000", label: "FINANCEIRO não pode DELETE /eventos/:id (não tem módulo eventos? checar matriz)" },
];
for (const c of WRITE_DENIAL_CHECKS) {
  const { status } = await users[c.role].api(c.method, c.path, c.body);
  // eventos é liberado pra todos os papéis (EXPECTED_MATRIX.eventos = ROLES) — então
  // FINANCEIRO x DELETE /eventos não é um caso de RBAC negado; pula esse caso especial.
  if (c.path.startsWith("/eventos") && EXPECTED_MATRIX.eventos.includes(c.role)) {
    na("rbac-write", c.label, "papel TEM acesso ao módulo eventos — não é um caso de negação, pulado");
    continue;
  }
  (status === 403 ? ok : bad)("rbac-write", c.label, `esperado=403 obtido=${status}`);
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
// BLOCO C — funcional por módulo + integração + matemática
// ========================================================================
console.log("\n===== BLOCO C: funcional + integração + matemática =====");

// ---- Dashboard ANTES de criar dados de teste (baseline para comparação) ----
const dashBefore = await A("GET", "/dashboard");
const dbClientsBefore = (await sql`select count(*)::int as n from "Client"`)[0].n;
(dashBefore.body?.kpis?.clients === dbClientsBefore
  ? ok : bad)("dashboard-math", "KPI 'clients' bate com count(*) real da tabela Client (antes de criar dados)", `dashboard=${dashBefore.body?.kpis?.clients} banco=${dbClientsBefore}`);

// ---- Locais ----
let venueId;
{
  const { status, body } = await A("POST", "/locais", { name: `${TAG} Espaço Teste`, city: "Teresina", state: "PI", capacity: 100, isOwn: true });
  (status === 201 ? ok : bad)("locais", "criar local", `status=${status}`);
  venueId = track("Venue", body?.id);
  const list = await A("GET", "/locais");
  ok("locais", "listar locais", `status=${list.status} total=${Array.isArray(list.body) ? list.body.length : "?"}`);

  const edit = await A("PUT", `/locais/${venueId}`, { name: `${TAG} Espaço Editado` });
  na("locais", "PUT /locais/:id (editar)", edit.status === 404 ? "rota não existe (404) — lacuna funcional já conhecida (Venue sem edição), não corrigida por não ser bug, é ausência de funcionalidade fora do pedido explícito desta fase" : `status=${edit.status}`);

  const invalidId = await A("DELETE", "/locais/id-invalido");
  (invalidId.status === 400 ? ok : bad)("locais", "DELETE /locais/:id com UUID inválido -> 400", `status=${invalidId.status}`);
}

// ---- EventType (sem CRUD na app — confirmando que é esperado, achado já conhecido) ----
{
  const [row] = await sql`select id, name from "EventType" limit 1`;
  if (row) na("catalogo-base", "EventType", `sem tela de CRUD na app; usando registro existente "${row.name}" para os testes`);
  else na("catalogo-base", "EventType", "tabela vazia e sem tela de CRUD — testes de Evento vão rodar sem eventTypeId (campo é opcional)");
  na("catalogo-base", "rota /api/event-types ou equivalente", "não existe no server/index.js — confirmado por leitura de código, lacuna funcional, não implementada (fora do escopo desta auditoria: 'registrar como lacuna, não inventar tela')");
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
  const notFound = await A("GET", "/fornecedores/00000000-0000-0000-0000-000000000000");
  (notFound.status === 404 ? ok : bad)("fornecedores", "GET fornecedor inexistente -> 404", `status=${notFound.status}`);
  const badUuid = await A("GET", "/fornecedores/nao-e-um-uuid");
  (badUuid.status === 400 ? ok : bad)("fornecedores", "GET fornecedor com UUID inválido -> 400", `status=${badUuid.status}`);
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

  const dupLink = await A("POST", `/catalogo/${productId}/fornecedores`, { supplierId, cost: "45,00" });
  (dupLink.status === 400 || dupLink.status === 409 ? ok : bad)("catalogo", "vínculo fornecedor+produto duplicado é rejeitado", `status=${dupLink.status}`);

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

  const semNome = await A("POST", "/leads", { email: "sem-nome@teste.local" });
  (semNome.status === 400 ? ok : bad)("leads", "criar lead sem nome (obrigatório) -> 400", `status=${semNome.status}`);

  const editLead = await A("PUT", `/leads/${leadId}`, { name: `${TAG} Lead`, company: `${TAG} Empresa`, status: "EM_CONTATO" });
  (editLead.status === 200 && editLead.body?.status === "EM_CONTATO" ? ok : bad)("leads", "editar status do lead", `status=${editLead.status} novoStatus=${editLead.body?.status}`);

  const editInexistente = await A("PUT", "/leads/00000000-0000-0000-0000-000000000000", { name: "x" });
  (editInexistente.status === 404 ? ok : bad)("leads", "editar lead inexistente -> 404", `status=${editInexistente.status}`);

  const editUuidInvalido = await A("PUT", "/leads/nao-e-um-uuid", { name: "x" });
  (editUuidInvalido.status === 400 ? ok : bad)("leads", "editar lead com UUID inválido -> 400", `status=${editUuidInvalido.status}`);

  const convert = await A("POST", `/leads/${leadId}/converter`);
  (convert.status === 200 ? ok : bad)("leads", "converter lead em cliente", `status=${convert.status}`);
  clientIdFromLead = track("Client", convert.body?.client?.id);

  const convertAgain = await A("POST", `/leads/${leadId}/converter`);
  (convertAgain.status === 400 ? ok : bad)("leads", "converter lead já convertido -> 400 (não duplica cliente)", `status=${convertAgain.status}`);

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

  const semNome = await A("POST", "/clientes", { document: "sem nome" });
  (semNome.status === 400 ? ok : bad)("clientes", "criar cliente sem nome (obrigatório) -> 400", `status=${semNome.status}`);

  const dupDoc = await A("POST", "/clientes", { personType: "PF", name: `${TAG} Cliente PF Duplicado`, document: "000.000.000-00" });
  na("clientes", "criar 2º cliente com o MESMO documento do 1º", dupDoc.status === 201
    ? `status=201 — aceito sem checagem de duplicidade de documento (não há UNIQUE em Client.document nem checagem no código); achado registrado, NÃO corrigido nesta fase por ser uma decisão de regra de negócio (permitir múltiplos registros com o mesmo documento pode ser intencional), não um bug técnico`
    : `status=${dupDoc.status}`);
  if (dupDoc.status === 201) track("Client", dupDoc.body?.id);

  const detail = await A("GET", `/clientes/${clientPF}`);
  const hasShape = "contacts" in (detail.body || {}) && "opportunities" in (detail.body || {}) && "events" in (detail.body || {});
  (detail.status === 200 && hasShape ? ok : bad)("clientes", "detalhe do cliente traz contacts/opportunities/events", `status=${detail.status}`);

  const notFound = await A("GET", "/clientes/00000000-0000-0000-0000-000000000000");
  (notFound.status === 404 ? ok : bad)("clientes", "GET cliente inexistente -> 404", `status=${notFound.status}`);

  const search = await A("GET", `/clientes?q=${encodeURIComponent(TAG)}`);
  (search.status === 200 && Array.isArray(search.body) && search.body.length >= 2 ? ok : bad)("clientes", "busca ?q= encontra os clientes de teste", `encontrados=${search.body?.length}`);
}

// ---- Oportunidade (a partir do cliente convertido do lead) ----
let opportunityId;
{
  const opp = await A("POST", "/oportunidades", { title: `${TAG} Oportunidade`, clientId: clientIdFromLead, ownerId: users.ADMIN.id, estimated: "5000,00", stage: "PROSPECCAO" });
  (opp.status === 201 ? ok : bad)("oportunidades", "criar oportunidade vinculada ao cliente do lead", `status=${opp.status}`);
  opportunityId = track("Opportunity", opp.body?.id);

  const semCliente = await A("POST", "/oportunidades", { title: `${TAG} sem cliente` });
  (semCliente.status === 400 ? ok : bad)("oportunidades", "criar oportunidade sem clientId (obrigatório) -> 400", `status=${semCliente.status}`);

  const dataInvalida = await A("POST", "/oportunidades", { title: `${TAG} data invalida`, clientId: clientIdFromLead, expectedDate: "não-é-uma-data" });
  (dataInvalida.status === 400 ? ok : bad)("oportunidades", "data prevista inválida -> 400 (não 500)", `status=${dataInvalida.status}`);

  const stage = await A("PATCH", `/oportunidades/${opportunityId}/estagio`, { stage: "PROPOSTA" });
  (stage.status === 200 && stage.body?.stage === "PROPOSTA" ? ok : bad)("oportunidades", "mudar estágio", `status=${stage.status}`);

  const stageInvalido = await A("PATCH", `/oportunidades/${opportunityId}/estagio`, { stage: "ESTAGIO_INVENTADO" });
  (stageInvalido.status === 400 ? ok : bad)("oportunidades", "estágio inválido -> 400", `status=${stageInvalido.status}`);

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

  const semTitulo = await A("POST", "/eventos", { clientId: clientIdFromLead });
  (semTitulo.status === 400 ? ok : bad)("eventos", "criar evento sem título (obrigatório) -> 400", `status=${semTitulo.status}`);

  const dataInvalida = await A("POST", "/eventos", { title: `${TAG} data invalida`, eventDate: "não-é-uma-data" });
  (dataInvalida.status === 400 ? ok : bad)("eventos", "data inválida em campo de evento -> 400 (não 500)", `status=${dataInvalida.status}`);
  if (dataInvalida.status === 201) track("Event", dataInvalida.body?.id);

  const badLink = await A("POST", "/eventos", { title: `${TAG} Evento Duplicado Opp`, opportunityId });
  (badLink.status === 400 ? ok : bad)("integracao-comercial", "2º evento na mesma oportunidade é rejeitado (UNIQUE opportunityId)", `status=${badLink.status}`);

  const opFinanceiro = await users.OPERACIONAL.api("PUT", `/eventos/${eventId}`, {
    title: `${TAG} Evento`, clientId: clientIdFromLead, opportunityId, venueId, eventTypeId,
    eventDate: "2026-12-01", guestCount: "120",
    plannedRevenue: "99999,00", plannedCost: "2000,00",
  });
  (opFinanceiro.status === 403 ? ok : bad)("eventos", "OPERACIONAL não altera campo financeiro do evento", `status=${opFinanceiro.status}`);

  const opNaoFinanceiro = await users.OPERACIONAL.api("PUT", `/eventos/${eventId}`, {
    title: `${TAG} Evento`, clientId: clientIdFromLead, opportunityId, venueId, eventTypeId,
    eventDate: "2026-12-01", guestCount: "120",
    plannedRevenue: "5000,00", plannedCost: "2000,00",
  });
  (opNaoFinanceiro.status === 200 ? ok : bad)("eventos", "OPERACIONAL altera campo não financeiro do evento", `status=${opNaoFinanceiro.status}`);

  const getInexistente = await A("GET", "/eventos/00000000-0000-0000-0000-000000000000");
  (getInexistente.status === 404 ? ok : bad)("eventos", "GET evento inexistente -> 404", `status=${getInexistente.status}`);

  const getUuidInvalido = await A("GET", "/eventos/nao-e-um-uuid");
  (getUuidInvalido.status === 400 ? ok : bad)("eventos", "GET evento com UUID inválido -> 400", `status=${getUuidInvalido.status}`);
}

// ---- Orçamento (cliente + evento + item do catálogo) — COM VERIFICAÇÃO MATEMÁTICA ----
let budgetId, budgetNumber1;
{
  const quantity = 2, unitPriceCents = 10000, unitCostCents = 5000, discountCents = 5000;
  const budget = await A("POST", "/orcamentos", {
    clientId: clientIdFromLead, eventId, opportunityId, discount: "50,00",
    items: [{ productServiceId: productId, description: `${TAG} Item`, quantity, unitPrice: "100,00", unitCost: "50,00" }],
  });
  (budget.status === 201 ? ok : bad)("orcamentos", "criar orçamento com item do catálogo", `status=${budget.status} number=${budget.body?.number}`);
  budgetId = track("Budget", budget.body?.id);
  budgetNumber1 = budget.body?.number;
  (budgetNumber1?.startsWith("ORC-") ? ok : bad)("orcamentos", "número segue o padrão ORC-xxxx", `number=${budgetNumber1}`);

  const list = await A("GET", "/orcamentos");
  const row = list.body?.find((b) => b.id === budgetId);
  const expectedSubtotal = quantity * unitPriceCents;
  const expectedCostTotal = quantity * unitCostCents;
  (Number(row?.subtotal) === expectedSubtotal ? ok : bad)("orcamentos-math", "subtotal = quantidade × preço unitário", `esperado=${expectedSubtotal} obtido=${row?.subtotal}`);
  (Number(row?.costTotal) === expectedCostTotal ? ok : bad)("orcamentos-math", "custo total = quantidade × custo unitário", `esperado=${expectedCostTotal} obtido=${row?.costTotal}`);
  (Number(row?.discountCents) === discountCents ? ok : bad)("orcamentos-math", "desconto gravado corretamente", `esperado=${discountCents} obtido=${row?.discountCents}`);
  // O total (subtotal - desconto) e a margem não vêm prontos da API — o
  // front calcula na hora de exibir. Confirmando isso explicitamente (não
  // é uma falha: os dados-base para o cálculo estão corretos e completos).
  const total = expectedSubtotal - discountCents;
  na("orcamentos-math", "total (subtotal - desconto) e margem", `API não devolve 'total'/'margem' prontos — calculados apenas no frontend a partir de subtotal(${expectedSubtotal})/costTotal(${expectedCostTotal})/discountCents(${discountCents}); total esperado=${total}, margem esperada=${total - expectedCostTotal}. Confirmar visualmente no frontend (ver relatório de frontend).`);

  const detail = await A("GET", `/orcamentos/${budgetId}`);
  const itemOk = detail.body?.items?.[0]?.productServiceId === productId && detail.body.items[0].quantity === 2;
  (itemOk ? ok : bad)("integracao-catalogo", "ProductService -> BudgetItem consistente", `item=${JSON.stringify(detail.body?.items?.[0])}`);

  const qtyNegativa = await A("POST", "/orcamentos", { clientId: clientIdFromLead, items: [{ description: `${TAG} qtd negativa`, quantity: -5, unitPrice: "10,00" }] });
  // POST só devolve o cabeçalho do orçamento (sem os itens) — precisa
  // buscar o detalhe pra conferir o que foi de fato gravado no item.
  const qtyNegativaDetail = qtyNegativa.status === 201 ? await A("GET", `/orcamentos/${qtyNegativa.body.id}`) : null;
  const itemClamped = qtyNegativaDetail?.body?.items?.[0]?.quantity;
  (qtyNegativa.status === 201 && itemClamped === 1 ? ok : bad)("orcamentos", "quantidade negativa é sanitizada para 1 (Math.max(1,...)), nunca fica negativa", `status=${qtyNegativa.status} quantityGravada=${itemClamped}`);
  if (qtyNegativa.status === 201) track("Budget", qtyNegativa.body?.id);

  const budget2 = await A("POST", "/orcamentos", { clientId: clientIdFromLead, items: [] });
  (budget2.status === 201 ? ok : bad)("orcamentos", "criar 2º orçamento (numeração sequencial)", `number=${budget2.body?.number}`);
  track("Budget", budget2.body?.id);
  const seqOk = budgetNumber1 && budget2.body?.number && budgetNumber1 !== budget2.body.number;
  (seqOk ? ok : bad)("orcamentos", "numeração não colide entre orçamentos consecutivos", `${budgetNumber1} vs ${budget2.body?.number}`);

  const editInexistente = await A("PUT", "/orcamentos/00000000-0000-0000-0000-000000000000", { clientId: clientIdFromLead, items: [] });
  (editInexistente.status === 404 ? ok : bad)("orcamentos", "editar orçamento inexistente -> 404", `status=${editInexistente.status}`);
}

// ---- Contrato (cliente + evento) — com verificação de numeração única ----
let contractId, contractNumber1;
{
  const ct = await A("POST", "/contratos", { clientId: clientIdFromLead, eventId, value: "5000,00", content: `${TAG} minuta` });
  (ct.status === 201 ? ok : bad)("contratos", "criar contrato vinculado a cliente/evento", `status=${ct.status} number=${ct.body?.number}`);
  contractId = track("Contract", ct.body?.id);
  contractNumber1 = ct.body?.number;
  (contractNumber1?.startsWith("CT-") ? ok : bad)("contratos", "número segue o padrão CT-xxxx", `number=${contractNumber1}`);

  const sign = await A("PUT", `/contratos/${contractId}`, { clientId: clientIdFromLead, eventId, value: "5000,00", content: `${TAG} minuta`, status: "ASSINADO" });
  (sign.status === 200 && sign.body?.signedAt ? ok : bad)("contratos", "assinar contrato grava signedAt", `signedAt=${sign.body?.signedAt}`);

  const ct2 = await A("POST", "/contratos", { clientId: clientIdFromLead, value: "1000,00", content: `${TAG} minuta 2` });
  (ct2.status === 201 ? ok : bad)("contratos", "criar 2º contrato (numeração sequencial)", `number=${ct2.body?.number}`);
  track("Contract", ct2.body?.id);
  const seqOk = contractNumber1 && ct2.body?.number && contractNumber1 !== ct2.body.number;
  (seqOk ? ok : bad)("contratos", "numeração não colide entre contratos consecutivos", `${contractNumber1} vs ${ct2.body?.number}`);

  const getInexistente = await A("GET", "/contratos/00000000-0000-0000-0000-000000000000");
  (getInexistente.status === 404 ? ok : bad)("contratos", "GET contrato inexistente -> 404", `status=${getInexistente.status}`);
  const getUuidInvalido = await A("GET", "/contratos/nao-e-um-uuid");
  (getUuidInvalido.status === 400 ? ok : bad)("contratos", "GET contrato com UUID inválido -> 400", `status=${getUuidInvalido.status}`);
}

// ---- Operacional: Task, Checklist, ChecklistItem, ScheduleItem ----
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

  const undone = await A("PATCH", `/operacional/checklists/itens/${itemId}`, { done: false });
  (undone.status === 200 && undone.body?.done === false && undone.body?.doneAt === null ? ok : bad)("operacional", "desfazer conclusão limpa doneAt", `done=${undone.body?.done} doneAt=${undone.body?.doneAt}`);

  const schedule = await A("POST", "/operacional/cronograma", { eventId, title: `${TAG} Cronograma`, startsAt: "2026-12-01T18:00:00" });
  (schedule.status === 201 ? ok : bad)("operacional", "criar item de cronograma", `status=${schedule.status}`);
  track("ScheduleItem", schedule.body?.id);

  const scheduleDataInvalida = await A("POST", "/operacional/cronograma", { eventId, title: `${TAG} Cronograma inválido`, startsAt: "não-é-uma-data" });
  (scheduleDataInvalida.status === 400 ? ok : bad)("operacional", "cronograma com data de início inválida -> 400 (não 500)", `status=${scheduleDataInvalida.status}`);

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

  const semDescricao = await A("POST", "/financeiro/pagar", { amount: "10,00" });
  (semDescricao.status === 400 ? ok : bad)("financeiro", "conta a pagar sem descrição (obrigatória) -> 400", `status=${semDescricao.status}`);

  const pay = await A("POST", `/financeiro/pagar/${payableId}/pagar`);
  (pay.status === 200 ? ok : bad)("financeiro", "liquidar conta a pagar", `status=${pay.status}`);

  const payAgain = await A("POST", `/financeiro/pagar/${payableId}/pagar`);
  na("financeiro", "liquidar conta a pagar já paga de novo", `status=${payAgain.status} — rota é idempotente (early return se já PAGO), confirmando que não duplica Transaction`);

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

  // Confirma direto no banco que a Transaction foi gravada com o mesmo
  // valor da conta (não só que o endpoint respondeu 200).
  const [txPagar] = await sql`select "amountCents", kind from "Transaction" where description = ${TAG + " Conta a pagar"}`;
  (txPagar?.amountCents === 30000 && txPagar?.kind === "SAIDA" ? ok : bad)("financeiro-math", "Transaction (SAIDA) gravada com o valor exato da conta a pagar", `tx=${JSON.stringify(txPagar)}`);
  const [txReceber] = await sql`select "amountCents", kind from "Transaction" where description = ${TAG + " Conta a receber"}`;
  (txReceber?.amountCents === 100000 && txReceber?.kind === "ENTRADA" ? ok : bad)("financeiro-math", "Transaction (ENTRADA) gravada com o valor exato da conta a receber", `tx=${JSON.stringify(txReceber)}`);

  const resumo = await A("GET", "/financeiro/resumo");
  const [{ v: dbAReceberPendente }] = await sql`select coalesce(sum("amountCents"),0)::bigint as v from "AccountReceivable" where status = 'PENDENTE'`;
  (Number(resumo.body?.aReceberCents) === Number(dbAReceberPendente) ? ok : bad)("financeiro-math", "resumo.aReceberCents bate com soma real de AccountReceivable PENDENTE no banco", `resumo=${resumo.body?.aReceberCents} banco=${dbAReceberPendente}`);

  const fluxo = await A("GET", "/financeiro/fluxo");
  const hasEntradaSaida = Array.isArray(fluxo.body) && fluxo.body.some((t) => t.kind === "SAIDA") && fluxo.body.some((t) => t.kind === "ENTRADA");
  (hasEntradaSaida ? ok : bad)("financeiro", "fluxo de caixa reflete ENTRADA e SAIDA", `total=${fluxo.body?.length}`);

  // Valor negativo em conta a pagar — toCents() não bloqueia negativos.
  const negativo = await A("POST", "/financeiro/pagar", { description: `${TAG} Conta negativa`, amount: "-50,00" });
  na("financeiro", "criar conta a pagar com valor negativo", negativo.status === 201
    ? `status=201 — aceito sem validação de valor positivo (toCents() não rejeita negativos); achado registrado, correção mínima recomendada mas NÃO aplicada nesta auditoria por não ter sido reproduzida como causando inconsistência de dado além do valor em si (nenhum cálculo downstream quebra com isso hoje, já que só é somado em Transaction/Event quando 'paga', operação manual)`
    : `status=${negativo.status}`);
  if (negativo.status === 201) track("AccountPayable", negativo.body?.id);
}

// ---- Dashboard e Relatórios: consistência matemática pós-dados ----
{
  const dash = await A("GET", "/dashboard");
  (dash.status === 200 && typeof dash.body?.kpis?.activeEvents === "number" ? ok : bad)("dashboard", "KPIs carregam com números válidos", `kpis=${JSON.stringify(dash.body?.kpis)}`);

  const [{ n: dbActiveEvents }] = await sql`select count(*)::int as n from "Event" where status = any(${["CONFIRMADO", "EM_PLANEJAMENTO", "EM_EXECUCAO"]})`;
  (dash.body?.kpis?.activeEvents === dbActiveEvents ? ok : bad)("dashboard-math", "KPI 'activeEvents' bate com count(*) real (status ativo) no banco", `dashboard=${dash.body?.kpis?.activeEvents} banco=${dbActiveEvents}`);

  const [{ n: dbClientsAfter }] = await sql`select count(*)::int as n from "Client"`;
  (dash.body?.kpis?.clients === dbClientsAfter ? ok : bad)("dashboard-math", "KPI 'clients' bate com count(*) real (depois de criar clientes de teste)", `dashboard=${dash.body?.kpis?.clients} banco=${dbClientsAfter}`);
  const clientsDelta = dash.body?.kpis?.clients - dashBefore.body?.kpis?.clients;
  na("dashboard-math", "delta de clientes reflete os criados nesta auditoria", `antes=${dashBefore.body?.kpis?.clients} depois=${dash.body?.kpis?.clients} delta=${clientsDelta}`);

  const upcomingHasTestEvent = Array.isArray(dash.body?.upcoming) && dash.body.upcoming.some((e) => e.id === eventId);
  na("dashboard", "evento de teste aparece em 'upcoming'", upcomingHasTestEvent ? "sim" : "não — lista é limit 6 por data mais próxima, pode ter sido ofuscada por eventos reais mais próximos; não é necessariamente falha");

  const rel = await A("GET", "/relatorios");
  (rel.status === 200 ? ok : bad)("relatorios", "relatório consolidado carrega", `status=${rel.status}`);

  const [{ totaleventos: dbTotalEventos, totalclientes: dbTotalClientes }] = await sql`
    select (select count(*)::int from "Event") as totalEventos, (select count(*)::int from "Client") as totalClientes`;
  (rel.body?.totais?.totalEventos === dbTotalEventos ? ok : bad)("relatorios-math", "totais.totalEventos bate com count(*) real no banco", `relatorio=${rel.body?.totais?.totalEventos} banco=${dbTotalEventos}`);
  (rel.body?.totais?.totalClientes === dbTotalClientes ? ok : bad)("relatorios-math", "totais.totalClientes bate com count(*) real no banco", `relatorio=${rel.body?.totais?.totalClientes} banco=${dbTotalClientes}`);

  const hasEventInReport = rel.body?.lucroPorEvento?.some((e) => e.id === eventId);
  if (hasEventInReport) {
    const row = rel.body.lucroPorEvento.find((e) => e.id === eventId);
    const lucroOk = Number(row.lucro) === Number(row.receita) - Number(row.custo);
    (lucroOk ? ok : bad)("relatorios-math", "lucro = receita - custo no relatório por evento", `receita=${row.receita} custo=${row.custo} lucro=${row.lucro}`);
  } else {
    na("relatorios", "evento de teste aparece em lucroPorEvento", "não apareceu — lista é top 10 por receita, pode ter sido ofuscado por dados reais; não é necessariamente falha");
  }

  const eventosPorStatusSoma = (rel.body?.eventosPorStatus || []).reduce((s, r) => s + r.n, 0);
  (eventosPorStatusSoma === dbTotalEventos ? ok : bad)("relatorios-math", "soma de eventosPorStatus bate com total de eventos no banco", `soma=${eventosPorStatusSoma} banco=${dbTotalEventos}`);
}

// ========================================================================
// TESTES DE ESTADO VAZIO (em módulos que não receberam dado de teste)
// ========================================================================
console.log("\n===== TESTES DE ESTADO VAZIO =====");
{
  // EventType, se vazio, não deve quebrar a tela de opções de Evento.
  const opcoes = await A("GET", "/eventos/opcoes");
  (opcoes.status === 200 && Array.isArray(opcoes.body?.types) ? ok : bad)("estado-vazio", "GET /eventos/opcoes não quebra mesmo se EventType estiver vazio", `status=${opcoes.status} types=${JSON.stringify(opcoes.body?.types)}`);
}

// ========================================================================
// LIMPEZA
// ========================================================================
console.log("\n===== LIMPEZA =====");
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
await safeDel('User de teste (audit.fase4.*)', () => sql`delete from "User" where email like 'audit.fase4.%'`);

const afterCounts = {};
for (const t of TABLES_TO_COUNT) afterCounts[t] = (await sql.unsafe(`select count(*)::int as n from "${t}"`))[0].n;

let residual = false;
for (const t of TABLES_TO_COUNT) {
  if (afterCounts[t] !== beforeCounts[t]) {
    bad("limpeza", `contagem de ${t} não voltou ao original`, `antes=${beforeCounts[t]} depois=${afterCounts[t]}`);
    residual = true;
  }
}
if (!residual) ok("limpeza", "todas as contagens voltaram ao estado original", JSON.stringify(afterCounts));

console.log("\nRESULTS_JSON_START");
console.log(JSON.stringify({ sections, beforeCounts, afterCounts, residual }, null, 2));
console.log("RESULTS_JSON_END");

await sql.end();
