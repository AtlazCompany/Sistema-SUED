// Limpeza de usuários de teste. "AuditLog"."userId" é ON DELETE SET NULL:
// apagar só o usuário deixava o log das ações dele no banco, com ator nulo
// (53 linhas de resíduo na rodada de 08/10/2026). Por isso o log do ator
// sai ANTES do usuário. Não é um arquivo *.test.js — não roda sozinho.

export async function deleteTestUsers(sql, ids) {
  const list = ids.filter(Boolean);
  if (!list.length) return;
  await sql`delete from "AuditLog" where "userId" in ${sql(list)}`;
  await sql`delete from "User" where id in ${sql(list)}`;
}

export async function deleteTestUsersByEmail(sql, likePattern) {
  const rows = await sql`select id from "User" where email like ${likePattern}`;
  await deleteTestUsers(sql, rows.map((r) => r.id));
}
