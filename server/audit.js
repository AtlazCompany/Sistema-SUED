// Trilha de auditoria técnica (achado B9, Fase 5). Escopo autorizado
// explicitamente pelo usuário: só Financeiro, Contratos e Usuários (não é
// limite técnico — os demais módulos podem ganhar auditoria depois, sob
// pedido); retenção indefinida por enquanto (sem expurgo automático);
// consulta só via SQL direto (sem tela própria) — decisões de produto, não
// técnicas. Ver audit/phase5/05-proposta-b9.txt e CHECKPOINT.md.
import { prepInsert } from "./utils.js";

// Campos que NUNCA podem ir para before/after, por tabela — sem exceção.
const REDACT_FIELDS = {
  User: ["passwordHash"],
};

function redact(table, row) {
  if (!row) return null;
  const fields = REDACT_FIELDS[table];
  if (!fields) return row;
  const clone = { ...row };
  for (const f of fields) delete clone[f];
  return clone;
}

// `executor` é `sql` (fora de transação) ou o `tx` de um `sql.begin(...)` —
// passar o `tx` grava o log na MESMA transação da operação principal
// (recomendação técnica do achado B9: o log nunca "perde" um evento por uma
// falha exatamente entre a operação e a gravação do log).
export async function logAudit(executor, { table, recordId, action, user, before, after }) {
  const row = prepInsert(
    {
      table,
      recordId,
      action,
      userId: user.id,
      userName: user.name,
      before: executor.json(redact(table, before)),
      after: executor.json(redact(table, after)),
    },
    { updatedAt: false },
  );
  await executor`insert into "AuditLog" ${executor(row)}`;
}
