// Script de configuração ÚNICA e IDEMPOTENTE — Financeiro, Lote 1.
//
// Problema: o lançamento do fluxo de caixa ("Transaction") não guardava de
// qual conta a pagar/receber veio. Por isso excluir uma conta já paga/
// recebida deixava o lançamento e o realizado do evento no caixa, e não
// havia como desfazer (estornar) um pagamento.
//
// O que faz:
//   1. adiciona "Transaction"."receivableId" e "payableId" (uuid, nulos) + índices;
//   2. liga os lançamentos JÁ existentes à conta de origem, só quando o par é
//      inequívoco (mesma descrição, valor e evento, um lançamento para uma
//      conta). Quem não tiver par inequívoco fica sem vínculo e é só listado.
//
// Uso (rode server/backup-db.mjs ANTES):
//   node --env-file=.env setup-finance-links.mjs
//
// NÃO apaga nenhum dado. Reversível:
//   ALTER TABLE "Transaction" DROP COLUMN "receivableId", DROP COLUMN "payableId";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

const LINKS = [
  { column: "receivableId", index: "Transaction_receivableId_idx", accounts: "AccountReceivable", doneStatus: "RECEBIDO", kind: "ENTRADA" },
  { column: "payableId", index: "Transaction_payableId_idx", accounts: "AccountPayable", doneStatus: "PAGO", kind: "SAIDA" },
];

const keyOf = (r) => `${r.description}|${r.amountCents}|${r.eventId ?? ""}`;

try {
  for (const l of LINKS) {
    const [{ exists }] = await sql`
      select exists(
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'Transaction' and column_name = ${l.column}
      ) as exists`;
    if (exists) console.log(`- coluna "Transaction"."${l.column}" já existe.`);
    else {
      await sql.unsafe(`alter table "Transaction" add column "${l.column}" uuid`);
      console.log(`+ coluna "Transaction"."${l.column}" criada.`);
    }
    await sql.unsafe(`create index if not exists "${l.index}" on "Transaction" ("${l.column}")`);

    // Vínculo dos lançamentos antigos: só pares 1-para-1.
    const accounts = await sql.unsafe(`select id, description, "amountCents", "eventId" from "${l.accounts}" where status = '${l.doneStatus}'`);
    const orphans = await sql.unsafe(
      `select id, description, "amountCents", "eventId" from "Transaction"
       where kind = '${l.kind}' and "receivableId" is null and "payableId" is null`,
    );
    const accByKey = new Map();
    const txByKey = new Map();
    for (const a of accounts) accByKey.set(keyOf(a), [...(accByKey.get(keyOf(a)) || []), a]);
    for (const t of orphans) txByKey.set(keyOf(t), [...(txByKey.get(keyOf(t)) || []), t]);
    let linked = 0;
    let ambiguous = 0;
    for (const [key, accs] of accByKey) {
      const txs = txByKey.get(key) || [];
      if (accs.length === 1 && txs.length === 1) {
        await sql.unsafe(`update "Transaction" set "${l.column}" = $1 where id = $2`, [accs[0].id, txs[0].id]);
        linked += 1;
      } else if (txs.length) ambiguous += 1;
    }
    console.log(`  ${l.accounts}: ${linked} lançamento(s) antigo(s) ligado(s)${ambiguous ? `, ${ambiguous} grupo(s) ambíguo(s) sem vínculo` : ""}.`);
  }

  console.log("\nConcluído.");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
