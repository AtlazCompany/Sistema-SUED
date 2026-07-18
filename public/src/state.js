// Estado global mínimo da aplicação (usuário, rota, seleção atual).
// Simples de propósito — não é depósito de dados do sistema.

const state = {
  user: null, // { id, name, email, role }
  route: null, // { path, params }
  selectedEvent: null, // evento em foco (uso futuro)
};

const listeners = new Set();

export const store = {
  get: (key) => state[key],
  set(patch) {
    Object.assign(state, patch);
    listeners.forEach((fn) => fn(state));
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
