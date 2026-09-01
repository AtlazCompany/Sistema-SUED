// Fonte única de verdade do RBAC: mapa de papel → módulos permitidos.
// Consumido pelo frontend (config.js → canAccess, filtra o menu) e pelo
// backend (server/routes/*.js → requireRole, protege os endpoints), para
// que a matriz de permissões nunca precise ser duplicada manualmente.
const ALL_MODULES = [
  "dashboard", "crm", "eventos", "fornecedores",
  "orcamentos", "operacional", "financeiro", "contratos", "relatorios", "usuarios",
];

export const ROLE_MODULES = {
  ADMIN: ALL_MODULES,
  SOCIO: ALL_MODULES,
  COMERCIAL: ["dashboard", "crm", "eventos", "orcamentos", "contratos", "relatorios"],
  OPERACIONAL: ["dashboard", "eventos", "fornecedores", "operacional"],
  FINANCEIRO: ["dashboard", "eventos", "financeiro", "contratos", "relatorios"],
};

// Papéis autorizados a acessar um módulo (inverso de ROLE_MODULES) — usado
// pelo backend para montar requireRole(...) sem reescrever a matriz.
export function rolesForModule(module) {
  return Object.keys(ROLE_MODULES).filter((role) => ROLE_MODULES[role].includes(module));
}
