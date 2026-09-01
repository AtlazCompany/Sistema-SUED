// Script de configuração ÚNICA e IDEMPOTENTE — checagem de performance
// pré-lançamento. Adiciona índices em colunas de chave estrangeira que
// já são usadas em WHERE/subconsulta filtrada nos endpoints mais
// usados, mas ainda não tinham índice próprio:
//
//   Budget.eventId       — UPDATE de "vigente" (achado B18) roda a cada
//                           aprovação de orçamento; sem índice, varre a
//                           tabela inteira.
//   Contract.eventId     — mesmo caso do B18, a cada assinatura.
//   Checklist.eventId,
//   ChecklistItem.checklistId,
//   ScheduleItem.eventId — painel Operacional (tela mais usada por
//                           evento) filtra as 3 diretamente por essas
//                           colunas a cada carregamento.
//   Event.eventTypeId    — subconsulta de contagem em
//                           GET /api/tipos-evento roda 1x por tipo
//                           cadastrado, a cada carregamento da tela.
//
// Uso: node --env-file=.env setup-perf-indexes.mjs
//
// NÃO apaga, NÃO altera e NÃO reordena nenhum dado existente — só
// acelera consultas já existentes. Reversível (DROP INDEX).
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

async function ensureIndex(name, ddl) {
  const [{ exists }] = await sql`select exists(select 1 from pg_indexes where indexname = ${name}) as exists`;
  if (exists) {
    console.log(`- índice "${name}" já existe, nada a fazer.`);
    return;
  }
  const t0 = Date.now();
  await sql.unsafe(ddl);
  console.log(`+ índice "${name}" criado (${Date.now() - t0}ms).`);
}

try {
  await ensureIndex("Budget_eventId_idx", `CREATE INDEX "Budget_eventId_idx" ON "Budget" ("eventId")`);
  await ensureIndex("Contract_eventId_idx", `CREATE INDEX "Contract_eventId_idx" ON "Contract" ("eventId")`);
  await ensureIndex("Checklist_eventId_idx", `CREATE INDEX "Checklist_eventId_idx" ON "Checklist" ("eventId")`);
  await ensureIndex("ChecklistItem_checklistId_idx", `CREATE INDEX "ChecklistItem_checklistId_idx" ON "ChecklistItem" ("checklistId")`);
  await ensureIndex("ScheduleItem_eventId_idx", `CREATE INDEX "ScheduleItem_eventId_idx" ON "ScheduleItem" ("eventId")`);
  await ensureIndex("Event_eventTypeId_idx", `CREATE INDEX "Event_eventTypeId_idx" ON "Event" ("eventTypeId")`);

  console.log("\nConcluído. Nenhum dado existente foi alterado.");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
