// Notificações rápidas (toast).
export function toast(message, type = "success", timeout = 3500) {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const node = document.createElement("div");
  node.className = `toast toast--${type}`;
  node.textContent = message;
  stack.append(node);
  setTimeout(() => {
    node.style.opacity = "0";
    setTimeout(() => node.remove(), 200);
  }, timeout);
}
