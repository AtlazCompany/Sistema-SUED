// Roteamento centralizado (History API). Renderiza views na área de conteúdo.
import { store } from "./state.js";

let routes = [];
let container = null;
let onNavigate = null;

function compile(path) {
  const keys = [];
  const pattern = path.replace(/:([^/]+)/g, (_, k) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${pattern}$`), keys };
}

function match(pathname) {
  for (const r of routes) {
    const m = pathname.match(r.compiled.regex);
    if (m) {
      const params = {};
      r.compiled.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
  }
  return null;
}

async function render() {
  const pathname = window.location.pathname;
  const found = match(pathname) || match("/dashboard");
  const { route, params } = found;
  store.set({ route: { path: pathname, params } });
  if (onNavigate) onNavigate(route);

  container.innerHTML = '<div class="center-screen"><div class="spinner"></div></div>';
  try {
    const node = await route.view(params);
    container.replaceChildren(node);
    container.scrollTop = 0;
  } catch (err) {
    if (err.message === "unauthorized") return; // tratado globalmente
    container.replaceChildren(
      Object.assign(document.createElement("div"), {
        className: "empty",
        innerHTML: `<p class="empty__title">Não foi possível carregar</p><p class="empty__desc">${err.message}</p>`,
      }),
    );
  }
}

export const router = {
  init({ container: c, routes: r, onNavigate: cb }) {
    container = c;
    onNavigate = cb;
    routes = r.map((route) => ({ ...route, compiled: compile(route.path) }));
    window.addEventListener("popstate", render);
    // Intercepta cliques em links internos.
    document.addEventListener("click", (e) => {
      const link = e.target.closest("[data-link]");
      if (!link) return;
      e.preventDefault();
      router.navigate(link.getAttribute("href"));
    });
  },
  navigate(path, { replace = false } = {}) {
    if (path === window.location.pathname) return;
    window.history[replace ? "replaceState" : "pushState"]({}, "", path);
    render();
  },
  start() {
    render();
  },
};
