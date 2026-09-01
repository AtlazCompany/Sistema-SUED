// Matriz completa de RBAC: os 5 papéis × os 9 módulos, contra a matriz da
// Fase A1/A2 (public/src/roles.js). Não depende de banco.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rolesForModule } from "../../public/src/roles.js";

const ROLES = ["ADMIN", "SOCIO", "COMERCIAL", "OPERACIONAL", "FINANCEIRO"];

const EXPECTED = {
  dashboard: ["ADMIN", "SOCIO", "COMERCIAL", "OPERACIONAL", "FINANCEIRO"],
  crm: ["ADMIN", "SOCIO", "COMERCIAL"],
  eventos: ["ADMIN", "SOCIO", "COMERCIAL", "OPERACIONAL", "FINANCEIRO"],
  fornecedores: ["ADMIN", "SOCIO", "OPERACIONAL"],
  orcamentos: ["ADMIN", "SOCIO", "COMERCIAL"],
  operacional: ["ADMIN", "SOCIO", "OPERACIONAL"],
  financeiro: ["ADMIN", "SOCIO", "FINANCEIRO"],
  contratos: ["ADMIN", "SOCIO", "COMERCIAL", "FINANCEIRO"],
  relatorios: ["ADMIN", "SOCIO", "COMERCIAL", "FINANCEIRO"],
  // Fase 2: módulo de gestão de usuários — mesma paridade ADMIN/SOCIO já
  // existente em todo o resto da matriz (ROLE_MODULES.SOCIO === .ADMIN).
  usuarios: ["ADMIN", "SOCIO"],
};

for (const [module, allowedRoles] of Object.entries(EXPECTED)) {
  test(`módulo "${module}" — papéis permitidos batem com a matriz`, () => {
    const got = rolesForModule(module).slice().sort();
    const want = allowedRoles.slice().sort();
    assert.deepEqual(got, want);
  });

  for (const role of ROLES) {
    const shouldAllow = allowedRoles.includes(role);
    test(`${role} × ${module} → ${shouldAllow ? "permitido" : "negado"}`, () => {
      const allowed = rolesForModule(module).includes(role);
      assert.equal(allowed, shouldAllow);
    });
  }
}
