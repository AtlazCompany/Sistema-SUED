// Página pública do orçamento — sem login, acessada pelo link enviado ao
// cliente (/orcamento/:id). Protegida só pelo id ser um UUID não-adivinhável
// (mesmo padrão de "quem tem o link, vê" usado em outros pontos do
// projeto) — não existe listagem pública de orçamentos.
//
// "Tempo real" aqui é por polling (a cada 4s), não WebSocket — mais simples
// e suficiente para o caso de uso (o cliente acompanha a proposta sendo
// montada, com poucos segundos de atraso, enquanto o comercial edita numa
// aba do editor). Layout provisório com a identidade SUED, a ser ajustado
// quando um modelo de referência for enviado.
import { el } from "../utils.js";
import { renderOrcamentoDocumento } from "../components/orcamento-doc.js";
import { suedMonogram } from "../components/sued-monogram.js";

const POLL_MS = 4000;

async function fetchPublic(id) {
  const res = await fetch(`/api/orcamento-publico/${id}`, { credentials: "same-origin" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error((data && data.error) || "Não foi possível carregar o orçamento.");
  }
  return res.json();
}

function publicError(message) {
  return el("div", { class: "doc-public__error" }, [
    el("span", { html: suedMonogram(40) }),
    el("h1", { class: "font-display", style: "font-size:22px" }, "Não foi possível abrir"),
    el("p", {}, message),
  ]);
}

export async function renderOrcamentoPublico(id) {
  const root = el("div", { class: "doc-public" });

  let data;
  try {
    data = await fetchPublic(id);
  } catch (err) {
    root.replaceChildren(publicError(err.message));
    return root;
  }

  // O que o navegador imprime como cabeçalho/rodapé da página (se a opção
  // "Cabeçalhos e rodapés" do diálogo de impressão estiver ligada) usa o
  // title da aba — deixamos algo útil em vez do genérico "SUED · ERP".
  document.title = `Orçamento ${data.number || "SUED"}${data.clientName ? " — " + data.clientName : ""}`;

  const liveDot = el("span", { class: "doc-public__livedot" });
  const printBtn = el("button", { class: "btn btn--primary btn--sm no-print" }, "Baixar PDF");
  printBtn.onclick = () => window.print();

  const bar = el("div", { class: "doc-public__bar no-print" }, [
    el("div", { class: "doc-public__brandmini" }, [el("span", { html: suedMonogram(26) }), el("span", {}, "SUED")]),
    el("div", { class: "doc-public__live" }, [liveDot, el("span", {}, "Ao vivo")]),
    printBtn,
  ]);

  const docHost = el("div", { class: "doc-public__host" }, [renderOrcamentoDocumento(data)]);
  root.replaceChildren(bar, docHost);

  let lastStamp = data.updatedAt;
  setInterval(async () => {
    try {
      const fresh = await fetchPublic(id);
      if (fresh.updatedAt !== lastStamp) {
        lastStamp = fresh.updatedAt;
        docHost.replaceChildren(renderOrcamentoDocumento(fresh));
        liveDot.classList.add("doc-public__livedot--pulse");
        setTimeout(() => liveDot.classList.remove("doc-public__livedot--pulse"), 900);
      }
    } catch {
      // Falha de rede pontual — tenta de novo no próximo ciclo, sem alarmar
      // o cliente com um erro na tela por causa de uma requisição perdida.
    }
  }, POLL_MS);

  return root;
}
