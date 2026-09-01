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

export async function changePassword(currentPassword, newPassword, confirmNewPassword) {
  await api.put("/auth/senha", { currentPassword, newPassword, confirmNewPassword });
}

// Achado B14 (Fase 5): recuperação de senha por e-mail.
export async function requestPasswordReset(email) {
  return api.post("/auth/esqueci-senha", { email });
}

export async function resetPassword(token, newPassword, confirmNewPassword) {
  await api.post("/auth/redefinir-senha", { token, newPassword, confirmNewPassword });
}

export function currentUser() {
  return store.get("user");
}
