// Configurações do frontend: navegação e permissões por papel.
import { ROLE_MODULES } from "./roles.js";

export const APP_NAME = "SUED ERP";

// Itens do menu. `module` casa com as permissões por papel.
export const NAV_ITEMS = [
  { module: "dashboard", label: "Dashboard", path: "/dashboard", icon: "dashboard" },
  { module: "crm", label: "Leads", path: "/leads", icon: "userPlus" },
  { module: "crm", label: "Clientes", path: "/clientes", icon: "users" },
  { module: "crm", label: "Funil", path: "/funil", icon: "target" },
  { module: "eventos", label: "Eventos", path: "/eventos", icon: "calendar" },
  { module: "eventos", label: "Locais", path: "/locais", icon: "mapPin" },
  { module: "fornecedores", label: "Fornecedores", path: "/fornecedores", icon: "truck" },
  { module: "fornecedores", label: "Catálogo", path: "/catalogo", icon: "file" },
  { module: "orcamentos", label: "Orçamentos", path: "/orcamentos", icon: "file" },
  { module: "operacional", label: "Operacional", path: "/operacional", icon: "clipboard" },
  { module: "financeiro", label: "Financeiro", path: "/financeiro", icon: "wallet" },
  { module: "contratos", label: "Contratos", path: "/contratos", icon: "fileSignature" },
  { module: "relatorios", label: "Relatórios", path: "/relatorios", icon: "chart" },
  { module: "usuarios", label: "Usuários", path: "/usuarios", icon: "lock" },
];

// RBAC: quais módulos cada papel acessa — fonte única em ./roles.js,
// compartilhada com o backend (ver server/routes/*.js e server/auth.js).
export { ROLE_MODULES };

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
