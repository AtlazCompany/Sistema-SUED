// Ponto de entrada — ORQUESTRADOR da aplicação.
// Responsável por: inicializar, verificar autenticação, montar a casca/menu,
// iniciar o router e carregar a view atual. A lógica de cada módulo vive
// no seu próprio arquivo em /views.
import { loadSession } from "./auth.js";
import { store } from "./state.js";
import { router } from "./router.js";
import { renderShell, setActiveNav } from "./components/shell.js";
import { renderLogin, renderResetPassword } from "./views/login.js";
import { renderOrcamentoPublico } from "./views/orcamento-publico.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderClientes } from "./views/clientes.js";
import { renderLeads } from "./views/leads.js";
import { renderPipeline } from "./views/pipeline.js";
import { renderEventos } from "./views/eventos.js";
import { renderLocais } from "./views/locais.js";
import { renderFornecedores } from "./views/fornecedores.js";
import { renderCatalogo } from "./views/catalogo.js";
import { renderOrcamentos } from "./views/orcamentos.js";
import { renderOperacional } from "./views/operacional.js";
import { renderFinanceiro } from "./views/financeiro.js";
import { renderContratos } from "./views/contratos.js";
import { renderRelatorios } from "./views/relatorios.js";
import { renderUsuarios } from "./views/usuarios.js";

const appRoot = document.getElementById("app");

// Tabela de rotas → cada view no seu módulo.
const routes = [
  { path: "/dashboard", module: "dashboard", view: renderDashboard },
  { path: "/leads", module: "crm", view: renderLeads },
  { path: "/clientes", module: "crm", view: renderClientes },
  { path: "/funil", module: "crm", view: renderPipeline },
  { path: "/eventos", module: "eventos", view: renderEventos },
  { path: "/locais", module: "eventos", view: renderLocais },
  { path: "/fornecedores", module: "fornecedores", view: renderFornecedores },
  { path: "/catalogo", module: "fornecedores", view: renderCatalogo },
  { path: "/orcamentos", module: "orcamentos", view: renderOrcamentos },
  { path: "/operacional", module: "operacional", view: renderOperacional },
  { path: "/financeiro", module: "financeiro", view: renderFinanceiro },
  { path: "/contratos", module: "contratos", view: renderContratos },
  { path: "/relatorios", module: "relatorios", view: renderRelatorios },
  { path: "/usuarios", module: "usuarios", view: renderUsuarios },
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
    onNavigate: (route) => setActiveNav(route.path),
  });

  // Garante uma rota válida ao entrar.
  const path = window.location.pathname;
  const known = routes.some((r) => r.path === path);
  if (!known) router.navigate("/dashboard", { replace: true });
  else router.start();
}

// Sessão expirada em qualquer requisição → volta ao login.
window.addEventListener("auth:expired", showLogin);

// Achado B14 (Fase 5): link de redefinição de senha do e-mail — acessível
// fora do fluxo normal de sessão, mesmo sem estar logado (ou com uma sessão
// antiga ainda no navegador).
function showResetPassword() {
  appRoot.replaceChildren(
    renderResetPassword(() => {
      window.history.replaceState({}, "", "/");
      showLogin();
    }),
  );
}

// Link público do orçamento (/orcamento/:id) — enviado ao cliente, sem
// exigir login, igual ao caso de /redefinir-senha abaixo.
const publicBudgetMatch = window.location.pathname.match(/^\/orcamento\/([^/]+)$/);

async function init() {
  if (publicBudgetMatch) {
    appRoot.replaceChildren(await renderOrcamentoPublico(publicBudgetMatch[1]));
    return;
  }
  if (window.location.pathname === "/redefinir-senha") return showResetPassword();
  try {
    const user = await loadSession();
    if (user) startApp();
    else showLogin();
  } catch {
    showLogin();
  }
}

init();
