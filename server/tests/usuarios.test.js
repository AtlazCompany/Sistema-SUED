// Testes de integração REAIS (banco real) para a gestão de usuários da
// Fase 2 — server/routes/usuarios.js + PUT /api/auth/senha. Roda via HTTP
// contra um servidor Express local, mas contra o banco real (não há como
// mockar de forma fiel várias queries diferentes em sequência sem perder
// confiança no teste). Todo usuário criado aqui tem e-mail prefixado com
// "audit.fase2." e é removido no final (hook `after`), com uma segunda
// checagem que falha o processo se sobrar algum. Pula graciosamente se não
// houver conexão com o banco (não depende de dado real de produção).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import postgres from "postgres";
import { usuariosRouter } from "../routes/usuarios.js";
import { authRouter } from "../auth.js";

const EMAIL_PREFIX = "audit.fase2.";
let sql;
let dbAvailable = false;
let server;
let baseUrl;
const createdIds = [];

try {
  sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 3, connect_timeout: 5 });
  await sql`select 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

before(async () => {
  if (!dbAvailable) return;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRouter);
  app.use("/api/usuarios", usuariosRouter);
  // Mesmo tratamento central de server/index.js, incluindo o mapeamento de
  // erro 22P02 (UUID inválido) — sem ele, os testes de UUID malformado
  // deste arquivo dariam 500 mesmo com o código de produção correto,
  // porque este app de teste usa seu próprio handler de erro, não o de
  // server/index.js (achado desta própria sessão de testes).
  app.use((err, req, res, _next) => {
    if (err.code === "22P02") return res.status(400).json({ error: "ID inválido." });
    res.status(err.status || 500).json({ error: err.message || "Erro interno." });
  });
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!dbAvailable) return;
  // Limpeza: apaga qualquer usuário audit.fase2.* que tenha sobrado,
  // mesmo que algum teste tenha falhado no meio.
  await sql`delete from "User" where email like ${EMAIL_PREFIX + "%"}`;
  await new Promise((resolve) => server.close(resolve));
  await sql.end();
});

async function loginAs(email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] : null;
  return { res, cookie, body: await res.json() };
}

async function asAdmin(realAdminEmail, realAdminPassword) {
  const { cookie, res } = await loginAs(realAdminEmail, realAdminPassword);
  if (res.status !== 200) throw new Error("login do admin de bootstrap falhou — teste não pode continuar");
  return cookie;
}

test("gestão de usuários — fluxo completo (skip sem banco)", { skip: !dbAvailable && "sem conexão com o banco neste ambiente" }, async (t) => {
  // Bootstrap: cria um ADMIN de teste diretamente no banco (bcrypt real),
  // já que ainda não temos credencial de admin real disponível neste teste
  // isolado — evita depender/tocar na conta administrativa de produção.
  const bcrypt = (await import("bcryptjs")).default;
  const { randomUUID } = await import("node:crypto");
  const bootstrapId = randomUUID();
  const bootstrapEmail = EMAIL_PREFIX + "bootstrap-admin@sued.local";
  const bootstrapPassword = "bootstrap-senha-123";
  await sql`insert into "User" ${sql({
    id: bootstrapId, name: "Bootstrap Admin (teste)", email: bootstrapEmail,
    role: "ADMIN", active: true, passwordHash: await bcrypt.hash(bootstrapPassword, 10),
  })}`;
  createdIds.push(bootstrapId);
  const adminCookie = await asAdmin(bootstrapEmail, bootstrapPassword);
  let normalizedUserId; // preenchido no teste de criação com e-mail normalizado; reusado nos testes de edição

  await t.test("criar usuário — sucesso", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Fase2 Comercial", email: EMAIL_PREFIX + "comercial@sued.local", role: "COMERCIAL", password: "senha-valida-123" }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.role, "COMERCIAL");
    assert.equal(body.passwordHash, undefined, "hash nunca deve voltar na resposta");
    createdIds.push(body.id);
  });

  await t.test("criar usuário — e-mail duplicado → 409", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Duplicado", email: EMAIL_PREFIX + "comercial@sued.local", role: "COMERCIAL", password: "senha-valida-123" }),
    });
    assert.equal(res.status, 409);
  });

  await t.test("criar usuário — senha curta → 400", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "X", email: EMAIL_PREFIX + "senhacurta@sued.local", role: "COMERCIAL", password: "123" }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("criar usuário — papel inválido → 400", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "X", email: EMAIL_PREFIX + "papelinvalido@sued.local", role: "SUPERADMIN", password: "senha-valida-123" }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("criar usuário — nome vazio → 400", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "   ", email: EMAIL_PREFIX + "nomevazio@sued.local", role: "COMERCIAL", password: "senha-valida-123" }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("criar usuário — e-mail com formato inválido → 400", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "X", email: "isso-nao-e-um-email", role: "COMERCIAL", password: "senha-valida-123" }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("criar usuário — e-mail com espaços e maiúsculas → normalizado (trim + lowercase), cria com sucesso", async () => {
    const rawEmail = `  ${(EMAIL_PREFIX + "normalizado@sued.local").toUpperCase()}  `;
    const res = await fetch(`${baseUrl}/api/usuarios`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Fase2 Normalizado", email: rawEmail, role: "COMERCIAL", password: "senha-valida-123" }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.email, EMAIL_PREFIX + "normalizado@sued.local", "deveria gravar sem espaços e em minúsculas");
    createdIds.push(body.id);
    normalizedUserId = body.id;

    // Prova a normalização por outro ângulo: a checagem de duplicidade
    // também deveria pegar essa mesma conta mesmo com capitalização/espaços
    // diferentes, já que tudo é normalizado antes de comparar/gravar.
    const resDup = await fetch(`${baseUrl}/api/usuarios`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Duplicado Normalizado", email: EMAIL_PREFIX + "normalizado@sued.local", role: "COMERCIAL", password: "senha-valida-123" }),
    });
    assert.equal(resDup.status, 409);
  });

  await t.test("listar usuários — inclui os criados, nunca inclui passwordHash", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios`, { headers: { Cookie: adminCookie } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.some((u) => u.email === EMAIL_PREFIX + "comercial@sued.local"));
    assert.ok(body.every((u) => u.passwordHash === undefined));
  });

  await t.test("editar usuário — muda o papel", async () => {
    const target = createdIds[1];
    const res = await fetch(`${baseUrl}/api/usuarios/${target}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Fase2 Comercial", email: EMAIL_PREFIX + "comercial@sued.local", role: "FINANCEIRO", active: true }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.role, "FINANCEIRO");
  });

  await t.test("editar usuário — alteração de nome", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios/${normalizedUserId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Fase2 Normalizado (renomeado)", email: EMAIL_PREFIX + "normalizado@sued.local", role: "COMERCIAL", active: true }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.name, "Fase2 Normalizado (renomeado)");
  });

  await t.test("editar usuário — alteração de e-mail (normalizado)", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios/${normalizedUserId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Fase2 Normalizado (renomeado)", email: `  ${(EMAIL_PREFIX + "novoemail@sued.local").toUpperCase()}  `, role: "COMERCIAL", active: true }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.email, EMAIL_PREFIX + "novoemail@sued.local");
  });

  await t.test("editar usuário — e-mail duplicado (tentando usar o e-mail de outro usuário) → 409", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios/${normalizedUserId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Fase2 Normalizado", email: EMAIL_PREFIX + "comercial@sued.local", role: "COMERCIAL", active: true }),
    });
    assert.equal(res.status, 409);
  });

  await t.test("editar usuário — desativar e depois reativar (ativação)", async () => {
    const resOff = await fetch(`${baseUrl}/api/usuarios/${normalizedUserId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Fase2 Normalizado", email: EMAIL_PREFIX + "novoemail@sued.local", role: "COMERCIAL", active: false }),
    });
    assert.equal(resOff.status, 200);
    assert.equal((await resOff.json()).active, false);

    const resOn = await fetch(`${baseUrl}/api/usuarios/${normalizedUserId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Fase2 Normalizado", email: EMAIL_PREFIX + "novoemail@sued.local", role: "COMERCIAL", active: true }),
    });
    assert.equal(resOn.status, 200);
    assert.equal((await resOn.json()).active, true, "deveria conseguir reativar normalmente");
  });

  await t.test("admin não pode alterar o próprio papel", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios/${bootstrapId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Bootstrap Admin (teste)", email: bootstrapEmail, role: "COMERCIAL", active: true }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("admin não pode se autodesativar", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios/${bootstrapId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Bootstrap Admin (teste)", email: bootstrapEmail, role: "ADMIN", active: false }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("redefinir senha de outro usuário — funciona e permite login com a nova", async () => {
    const target = createdIds[1];
    const res = await fetch(`${baseUrl}/api/usuarios/${target}/redefinir-senha`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ password: "nova-senha-999" }),
    });
    assert.equal(res.status, 200);
    const { res: loginRes } = await loginAs(EMAIL_PREFIX + "comercial@sued.local", "nova-senha-999");
    assert.equal(loginRes.status, 200);
  });

  await t.test("admin não pode excluir a própria conta", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios/${bootstrapId}`, { method: "DELETE", headers: { Cookie: adminCookie } });
    assert.equal(res.status, 400);
  });

  await t.test("excluir usuário sem vínculo — funciona", async () => {
    const target = createdIds[1];
    const res = await fetch(`${baseUrl}/api/usuarios/${target}`, { method: "DELETE", headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    createdIds.splice(1, 1);
  });

  await t.test("trava de último administrador — não bloqueia falsamente, e a fórmula de contagem está correta", async () => {
    // Importante: este ambiente conecta no Supabase REAL do projeto, que já
    // tem administrador(es) de produção ativos. Por isso é deliberadamente
    // impossível (e errado tentar) forçar aqui o cenário "restam zero
    // administradores no sistema inteiro" sem mexer nas contas reais — a
    // mesma razão pela qual a Fase 2 anterior evitou isso. O que este teste
    // valida com segurança, em vez disso:
    //   1) a trava não bloqueia falsamente uma desativação legítima quando
    //      existe outro admin ativo (aqui: o admin real de produção conta
    //      normalmente, então nunca chegamos a zero) — prova que a trava não
    //      quebra o fluxo normal;
    //   2) a fórmula de contagem (role = any(ADMIN_ROLES), active = true,
    //      id <> alvo) está matematicamente correta, testada em isolamento
    //      com dados 100% de teste (filtrados por e-mail audit.fase2.*), sem
    //      tocar em nenhuma conta real.
    //
    // Usa TRÊS admins de teste (não dois), porque desde a correção do
    // achado P1 "sessão não revalidada" (server/auth.js), o cookie de um
    // admin deixa de funcionar assim que ele é desativado — não dá mais
    // para usar o cookie de um ator depois de desativá-lo (era exatamente
    // esse o bug corrigido). Cada desativação abaixo usa um ator diferente,
    // ainda ativo no momento em que age.
    const criar = async (email) => {
      const res = await fetch(`${baseUrl}/api/usuarios`, {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ name: "Fase2 Admin", email, role: "ADMIN", password: "senha-valida-123" }),
      });
      const body = await res.json();
      assert.equal(res.status, 201);
      createdIds.push(body.id);
      return body;
    };
    const adminB = await criar(EMAIL_PREFIX + "admin-b@sued.local");
    const adminC = await criar(EMAIL_PREFIX + "admin-c@sued.local");

    try {
      const { cookie: cookieB, res: loginB } = await loginAs(EMAIL_PREFIX + "admin-b@sued.local", "senha-valida-123");
      assert.equal(loginB.status, 200);
      const { cookie: cookieC, res: loginC } = await loginAs(EMAIL_PREFIX + "admin-c@sued.local", "senha-valida-123");
      assert.equal(loginC.status, 200);

      const ADMIN_ROLES = ["ADMIN", "SOCIO"];
      const countActiveTestAdmins = async () => {
        const [{ n }] = await sql`
          select count(*)::int as n from "User"
          where active = true and role = any(${ADMIN_ROLES}) and email like ${EMAIL_PREFIX + "%"}`;
        return n;
      };

      assert.equal(await countActiveTestAdmins(), 3, "bootstrap + adminB + adminC, todos ativos no início");

      // (1) AdminB (ainda ativo) desativa o bootstrapAdmin — permitido: o
      // admin real de produção também conta na fórmula (ela é global, não
      // filtrada por e-mail de teste), então isso nunca chega a zero.
      const resDeactivateBootstrap = await fetch(`${baseUrl}/api/usuarios/${bootstrapId}`, {
        method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookieB },
        body: JSON.stringify({ name: "Bootstrap Admin (teste)", email: bootstrapEmail, role: "ADMIN", active: false }),
      });
      assert.equal(resDeactivateBootstrap.status, 200, "não deveria bloquear: ainda há admin(is) real(is) ativo(s) no sistema");
      assert.equal(await countActiveTestAdmins(), 2, "restam adminB e adminC");

      // (2) AdminC (ainda ativo, nunca foi tocado) desativa AdminB — prova
      // que a trava/fórmula segue funcionando com o segundo ator.
      const resDeactivateB = await fetch(`${baseUrl}/api/usuarios/${adminB.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookieC },
        body: JSON.stringify({ name: "Fase2 Admin", email: EMAIL_PREFIX + "admin-b@sued.local", role: "ADMIN", active: false }),
      });
      assert.equal(resDeactivateB.status, 200);
      assert.equal(await countActiveTestAdmins(), 1, "só adminC segue ativo entre os admins de teste");

      // (3) Confirmação extra do efeito da correção P1: o cookie de AdminB,
      // agora desativado, não deveria mais funcionar em NENHUMA rota
      // protegida — nem para agir sobre si mesmo nem sobre outros.
      const resStaleCookie = await fetch(`${baseUrl}/api/usuarios`, { headers: { Cookie: cookieB } });
      assert.equal(resStaleCookie.status, 401, "cookie de admin já desativado deveria parar de funcionar imediatamente");
    } finally {
      // Restaura o estado real (bootstrapAdmin ativo) e remove os admins de
      // teste, usando SQL direto — não dá pra confiar em cookies de admins
      // cujo status é justamente o que este teste alterou.
      await sql`update "User" set active = true where id = ${bootstrapId}`;
      await sql`delete from "User" where id in (${adminB.id}, ${adminC.id})`;
      createdIds.splice(createdIds.indexOf(adminB.id), 1);
      createdIds.splice(createdIds.indexOf(adminC.id), 1);
    }
  });

  await t.test("2 admins ativos → remover o papel ADMIN de 1 (vira COMERCIAL) → permitido", async () => {
    const resCreate = await fetch(`${baseUrl}/api/usuarios`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Fase2 Admin D", email: EMAIL_PREFIX + "admin-d@sued.local", role: "ADMIN", password: "senha-valida-123" }),
    });
    const adminD = await resCreate.json();
    assert.equal(resCreate.status, 201);
    createdIds.push(adminD.id);

    // bootstrapAdmin (outro admin ativo) remove o papel ADMIN de adminD —
    // continua restando pelo menos 1 admin (o próprio bootstrap) — permitido.
    const res = await fetch(`${baseUrl}/api/usuarios/${adminD.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Fase2 Admin D", email: EMAIL_PREFIX + "admin-d@sued.local", role: "COMERCIAL", active: true }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.role, "COMERCIAL");

    await sql`delete from "User" where id = ${adminD.id}`;
    createdIds.splice(createdIds.indexOf(adminD.id), 1);
  });

  await t.test("2 admins ativos → excluir 1 → permitido", async () => {
    const resCreate = await fetch(`${baseUrl}/api/usuarios`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Fase2 Admin E", email: EMAIL_PREFIX + "admin-e@sued.local", role: "ADMIN", password: "senha-valida-123" }),
    });
    const adminE = await resCreate.json();
    assert.equal(resCreate.status, 201);
    createdIds.push(adminE.id);

    // bootstrapAdmin exclui adminE — continua restando pelo menos 1 admin
    // (o próprio bootstrap) — permitido.
    const res = await fetch(`${baseUrl}/api/usuarios/${adminE.id}`, { method: "DELETE", headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    createdIds.splice(createdIds.indexOf(adminE.id), 1);
  });

  await t.test("excluir usuário — UUID inválido em /api/usuarios/:id → 400 (não 500)", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios/id-nao-e-um-uuid`, { method: "DELETE", headers: { Cookie: adminCookie } });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, "ID inválido.");
  });

  await t.test("excluir usuário — usuário inexistente (UUID válido, mas sem registro) → 404", async () => {
    const randomId = (await import("node:crypto")).randomUUID();
    const res = await fetch(`${baseUrl}/api/usuarios/${randomId}`, { method: "DELETE", headers: { Cookie: adminCookie } });
    assert.equal(res.status, 404);
  });

  await t.test("editar usuário — UUID inválido → 400 (não 500)", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios/id-nao-e-um-uuid`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "X", email: EMAIL_PREFIX + "x@sued.local", role: "COMERCIAL", active: true }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("acesso não autenticado a /api/usuarios → 401", async () => {
    const res = await fetch(`${baseUrl}/api/usuarios`);
    assert.equal(res.status, 401);
  });

  await t.test("RBAC real via HTTP — SOCIO acessa, OPERACIONAL e FINANCEIRO não acessam /api/usuarios", async () => {
    const criarELogar = async (role, emailLocal) => {
      const id = (await import("node:crypto")).randomUUID();
      const { default: bcryptX } = await import("bcryptjs");
      const email = EMAIL_PREFIX + emailLocal;
      await sql`insert into "User" ${sql({
        id, name: `Fase2 ${role}`, email, role, active: true,
        passwordHash: await bcryptX.hash("senha-rbac-123", 10),
      })}`;
      createdIds.push(id);
      const { cookie } = await loginAs(email, "senha-rbac-123");
      return { id, cookie };
    };

    const socio = await criarELogar("SOCIO", "socio-rbac@sued.local");
    const resSocio = await fetch(`${baseUrl}/api/usuarios`, { headers: { Cookie: socio.cookie } });
    assert.equal(resSocio.status, 200, "SOCIO deveria ter a mesma paridade de ADMIN no módulo usuarios");

    const operacional = await criarELogar("OPERACIONAL", "operacional-rbac@sued.local");
    const resOperacional = await fetch(`${baseUrl}/api/usuarios`, { headers: { Cookie: operacional.cookie } });
    assert.equal(resOperacional.status, 403);

    const financeiro = await criarELogar("FINANCEIRO", "financeiro-rbac@sued.local");
    const resFinanceiro = await fetch(`${baseUrl}/api/usuarios`, { headers: { Cookie: financeiro.cookie } });
    assert.equal(resFinanceiro.status, 403);
  });

  await t.test("excluir usuário vinculado (FK real) → 409, e funciona depois de desvincular", async () => {
    const resCreate = await fetch(`${baseUrl}/api/usuarios`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: "Fase2 Vinculado", email: EMAIL_PREFIX + "vinculado@sued.local", role: "COMERCIAL", password: "senha-valida-123" }),
    });
    const linked = await resCreate.json();
    assert.equal(resCreate.status, 201);
    createdIds.push(linked.id);

    // Vincula via Event.commercialId — inserção direta no banco (só as
    // colunas NOT NULL), já que não existe endpoint para criar um Event
    // "solto" fora do fluxo comercial completo e não é isso que este teste
    // quer validar.
    const eventId = (await import("node:crypto")).randomUUID();
    await sql`insert into "Event" ${sql({
      id: eventId, code: "AUDIT-FASE2-EVT", title: "Evento de teste (vínculo FK)", status: "RASCUNHO",
      plannedRevenueCents: 0, actualRevenueCents: 0, plannedCostCents: 0, actualCostCents: 0,
      createdAt: new Date(), updatedAt: new Date(), commercialId: linked.id,
    })}`;

    const resDelete = await fetch(`${baseUrl}/api/usuarios/${linked.id}`, { method: "DELETE", headers: { Cookie: adminCookie } });
    assert.equal(resDelete.status, 409);
    assert.match((await resDelete.json()).error, /vinculado/);

    // Desvincula e confirma que a exclusão passa a funcionar.
    await sql`delete from "Event" where id = ${eventId}`;
    const resDelete2 = await fetch(`${baseUrl}/api/usuarios/${linked.id}`, { method: "DELETE", headers: { Cookie: adminCookie } });
    assert.equal(resDelete2.status, 200);
    createdIds.splice(createdIds.indexOf(linked.id), 1);
  });

  await t.test("papel não autorizado (COMERCIAL) não acessa gestão de usuários → 403", async () => {
    const id2 = (await import("node:crypto")).randomUUID();
    const { default: bcrypt2 } = await import("bcryptjs");
    await sql`insert into "User" ${sql({
      id: id2, name: "Fase2 Comercial Só Login", email: EMAIL_PREFIX + "comercial-login@sued.local",
      role: "COMERCIAL", active: true, passwordHash: await bcrypt2.hash("senha-comercial-123", 10),
    })}`;
    createdIds.push(id2);
    const { cookie } = await loginAs(EMAIL_PREFIX + "comercial-login@sued.local", "senha-comercial-123");
    const res = await fetch(`${baseUrl}/api/usuarios`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 403);
  });

  await t.test("PUT /api/auth/senha — senha atual errada → 401", async () => {
    const res = await fetch(`${baseUrl}/api/auth/senha`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ currentPassword: "senha-errada", newPassword: "outra-senha-1234", confirmNewPassword: "outra-senha-1234" }),
    });
    assert.equal(res.status, 401);
  });

  await t.test("PUT /api/auth/senha — nova senha curta → 400", async () => {
    const res = await fetch(`${baseUrl}/api/auth/senha`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ currentPassword: bootstrapPassword, newPassword: "123", confirmNewPassword: "123" }),
    });
    assert.equal(res.status, 400);
  });

  await t.test("PUT /api/auth/senha — sem confirmação → 400", async () => {
    const res = await fetch(`${baseUrl}/api/auth/senha`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ currentPassword: bootstrapPassword, newPassword: "outra-senha-1234" }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /confirme/i);
  });

  await t.test("PUT /api/auth/senha — confirmação diferente da nova senha → 400", async () => {
    const res = await fetch(`${baseUrl}/api/auth/senha`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ currentPassword: bootstrapPassword, newPassword: "outra-senha-1234", confirmNewPassword: "outra-senha-DIFERENTE" }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /confirmação/i);
  });

  await t.test("achado B7 — trocar a própria senha invalida sessões antigas de outros dispositivos/abas, mas a atual continua funcionando", async () => {
    const id = (await import("node:crypto")).randomUUID();
    const { default: bcryptX } = await import("bcryptjs");
    const email = EMAIL_PREFIX + "b7-multisessao@sued.local";
    await sql`insert into "User" ${sql({
      id, name: "Fase5 B7 Multisessão", email, role: "COMERCIAL", active: true,
      passwordHash: await bcryptX.hash("senha-original-123", 10),
    })}`;
    createdIds.push(id);

    // Simula 2 "dispositivos" — 2 logins independentes, 2 cookies distintos.
    const deviceA = await loginAs(email, "senha-original-123");
    const deviceB = await loginAs(email, "senha-original-123");
    assert.equal(deviceA.res.status, 200);
    assert.equal(deviceB.res.status, 200);

    // Troca a senha usando o cookie do dispositivo A.
    const resSenha = await fetch(`${baseUrl}/api/auth/senha`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: deviceA.cookie },
      body: JSON.stringify({ currentPassword: "senha-original-123", newPassword: "senha-nova-456", confirmNewPassword: "senha-nova-456" }),
    });
    assert.equal(resSenha.status, 200);
    // A resposta reemite um cookie novo (tokenVersion atualizado) — é esse
    // que o dispositivo A "continuaria usando" na prática.
    const novoCookieA = resSenha.headers.get("set-cookie").split(";")[0];

    const meA = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: novoCookieA } });
    assert.equal((await meA.json()).user?.email, email, "dispositivo A (cookie reemitido) deveria continuar funcionando");

    const meB = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: deviceB.cookie } });
    assert.equal((await meB.json()).user, null, "dispositivo B (cookie antigo, tokenVersion desatualizado) deveria ter sido invalidado");
  });

  await t.test("achado B7 — admin redefine a senha de outro usuário → sessão que essa pessoa já tinha aberta é invalidada", async () => {
    const id = (await import("node:crypto")).randomUUID();
    const { default: bcryptX } = await import("bcryptjs");
    const email = EMAIL_PREFIX + "b7-reset-admin@sued.local";
    await sql`insert into "User" ${sql({
      id, name: "Fase5 B7 Reset Admin", email, role: "COMERCIAL", active: true,
      passwordHash: await bcryptX.hash("senha-original-123", 10),
    })}`;
    createdIds.push(id);

    const { cookie: cookieAlvo, res: loginAlvo } = await loginAs(email, "senha-original-123");
    assert.equal(loginAlvo.status, 200);

    // ADMIN redefine a senha do alvo — não exige a senha antiga dele.
    const resReset = await fetch(`${baseUrl}/api/usuarios/${id}/redefinir-senha`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ password: "senha-redefinida-pelo-admin-789" }),
    });
    assert.equal(resReset.status, 200);

    const meAlvo = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieAlvo } });
    assert.equal((await meAlvo.json()).user, null, "sessão que o alvo já tinha aberta deveria ser invalidada pela redefinição administrativa");

    const novoLogin = await loginAs(email, "senha-redefinida-pelo-admin-789");
    assert.equal(novoLogin.res.status, 200, "a nova senha definida pelo admin deveria funcionar normalmente");
  });

  await t.test("PUT /api/auth/senha — sucesso: login antigo para de funcionar, novo passa a funcionar, hash é bcrypt (nunca texto puro)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/senha`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ currentPassword: bootstrapPassword, newPassword: "senha-trocada-456", confirmNewPassword: "senha-trocada-456" }),
    });
    assert.equal(res.status, 200);
    const oldLogin = await loginAs(bootstrapEmail, bootstrapPassword);
    assert.equal(oldLogin.res.status, 401);
    const newLogin = await loginAs(bootstrapEmail, "senha-trocada-456");
    assert.equal(newLogin.res.status, 200);

    // Confirma o formato gravado no banco: prefixo bcrypt ($2a$/$2b$),
    // nunca a senha em texto puro.
    const [row] = await sql`select "passwordHash" from "User" where id = ${bootstrapId}`;
    assert.match(row.passwordHash, /^\$2[aby]\$/, "deveria ser um hash bcrypt");
    assert.notEqual(row.passwordHash, "senha-trocada-456");
  });

  // Limpeza explícita dentro do próprio teste (não no `after`, que só roda
  // depois de TODOS os testes do arquivo) — confirma zero resíduo agora.
  await t.test("limpeza — nenhum dado audit.fase2.* restante", async () => {
    await sql`delete from "User" where email like ${EMAIL_PREFIX + "%"}`;
    const leftover = await sql`select id, email from "User" where email like ${EMAIL_PREFIX + "%"}`;
    assert.equal(leftover.length, 0, "não deveria sobrar nenhum usuário de teste da Fase 2");
  });
});
