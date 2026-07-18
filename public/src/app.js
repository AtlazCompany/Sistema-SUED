// Ponto de entrada — ORQUESTRADOR da aplicação.
// Responsável por: inicializar, verificar autenticação, montar a casca/menu,
// iniciar o router e carregar a view atual. A lógica de cada módulo vive
// no seu próprio arquivo em /views.
import { loadSession } from "./auth.js";
import { store } from "./state.js";
import { router } from "./router.js";
import { renderShell, setActiveNav } from "./components/shell.js";
import { renderLogin } from "./views/login.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderClientes } from "./views/clientes.js";
import { renderPlaceholder } from "./views/placeholder.js";

const appRoot = document.getElementById("app");

// Tabela de rotas → cada view no seu módulo.
const routes = [
  { path: "/dashboard", module: "dashboard", view: renderDashboard },
  { path: "/clientes", module: "crm", view: renderClientes },
  { path: "/eventos", module: "eventos", view: () => renderPlaceholder("Eventos", 4) },
  { path: "/fornecedores", module: "fornecedores", view: () => renderPlaceholder("Fornecedores", 5) },
  { path: "/orcamentos", module: "orcamentos", view: () => renderPlaceholder("Orçamentos", 6) },
  { path: "/financeiro", module: "financeiro", view: () => renderPlaceholder("Financeiro", 8) },
  { path: "/relatorios", module: "relatorios", view: () => renderPlaceholder("Relatórios", 10) },
];

function showLogin() {
  appRoot.replaceChildren(renderLogin(startApp));
}

function startApp() {
  const user = store.get("user");
  const { root, content } = renderShell(user, showLogin);
  appRoot.replaceChildren(root);

  router.init({
    container: content,
    routes,
    onNavigate: (route) => setActiveNav(route.module),
  });

  // Garante uma rota válida ao entrar.
  const path = window.location.pathname;
  const known = routes.some((r) => r.path === path);
  if (!known) router.navigate("/dashboard", { replace: true });
  else router.start();
}

// Sessão expirada em qualquer requisição → volta ao login.
window.addEventListener("auth:expired", showLogin);

async function init() {
  try {
    const user = await loadSession();
    if (user) startApp();
    else showLogin();
  } catch {
    showLogin();
  }
}

init();
