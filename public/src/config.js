// Configurações do frontend: navegação e permissões por papel.

export const APP_NAME = "SUED ERP";

// Itens do menu. `module` casa com as permissões por papel.
export const NAV_ITEMS = [
  { module: "dashboard", label: "Dashboard", path: "/dashboard", icon: "dashboard" },
  { module: "crm", label: "Clientes", path: "/clientes", icon: "users" },
  { module: "eventos", label: "Eventos", path: "/eventos", icon: "calendar", soon: true },
  { module: "fornecedores", label: "Fornecedores", path: "/fornecedores", icon: "truck", soon: true },
  { module: "orcamentos", label: "Orçamentos", path: "/orcamentos", icon: "file", soon: true },
  { module: "financeiro", label: "Financeiro", path: "/financeiro", icon: "wallet", soon: true },
  { module: "relatorios", label: "Relatórios", path: "/relatorios", icon: "chart", soon: true },
];

// RBAC: quais módulos cada papel acessa.
const ALL = NAV_ITEMS.map((i) => i.module);
export const ROLE_MODULES = {
  ADMIN: ALL,
  SOCIO: ALL,
  COMERCIAL: ["dashboard", "crm", "eventos", "orcamentos", "relatorios"],
  OPERACIONAL: ["dashboard", "eventos", "fornecedores"],
  FINANCEIRO: ["dashboard", "eventos", "financeiro", "relatorios"],
};

export const ROLE_LABELS = {
  ADMIN: "Administrador",
  SOCIO: "Sócio",
  COMERCIAL: "Comercial",
  OPERACIONAL: "Operacional",
  FINANCEIRO: "Financeiro",
};

export function canAccess(role, module) {
  return (ROLE_MODULES[role] || []).includes(module);
}
