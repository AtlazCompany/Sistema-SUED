// Autenticação isolada: fala com /api/auth e mantém o usuário no state.
import { api } from "./api.js";
import { store } from "./state.js";

export async function loadSession() {
  const { user } = await api.get("/auth/me");
  store.set({ user });
  return user;
}

export async function login(email, password) {
  const { user } = await api.post("/auth/login", { email, password });
  store.set({ user });
  return user;
}

export async function logout() {
  await api.post("/auth/logout");
  store.set({ user: null });
}

export function currentUser() {
  return store.get("user");
}
