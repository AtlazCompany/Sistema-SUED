// Comunicação centralizada com o backend.
// Nenhum módulo faz fetch direto — todos passam por aqui.
import { toast } from "./components/toast.js";

const BASE = "/api";

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    toast("Falha de conexão com o servidor.", "error");
    throw new Error("network");
  }

  // Sessão expirada → volta ao login.
  if (res.status === 401 && path !== "/auth/me" && path !== "/auth/login") {
    window.dispatchEvent(new CustomEvent("auth:expired"));
    throw new Error("unauthorized");
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const message = (data && data.error) || "Erro inesperado.";
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
  patch: (path, body) => request("PATCH", path, body),
  del: (path) => request("DELETE", path),
};
