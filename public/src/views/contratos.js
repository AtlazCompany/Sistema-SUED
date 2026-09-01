// View de Contratos: lista + editor (condições, status, gerar minuta base).
import { api } from "../api.js";
import { el, formatBRL, formatDate } from "../utils.js";
import { icon } from "../components/icons.js";
import { renderTable } from "../components/table.js";
import { toast } from "../components/toast.js";
import { field } from "../components/form.js";

const STATUS = {
  RASCUNHO: { label: "Rascunho", cls: "badge--muted" },
  ENVIADO: { label: "Enviado", cls: "badge--info" },
  ASSINADO: { label: "Assinado", cls: "badge--success" },
  CANCELADO: { label: "Cancelado", cls: "badge--danger" },
};

function minuta(clientName, eventTitle, valueCents) {
  const valor = valueCents ? formatBRL(valueCents) : "R$ __________";
  return (
`CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE EVENTOS

CONTRATANTE: ${clientName || "__________"}
CONTRATADA: SUED Eventos

OBJETO: Prestação dos serviços referentes ao evento "${eventTitle || "__________"}".

VALOR: ${valor}, conforme condições acordadas no orçamento aprovado.

CONDIÇÕES:
1. O pagamento seguirá o cronograma financeiro acordado entre as partes.
2. A SUED responsabiliza-se pela organização e execução dos serviços contratados.
3. Alterações de escopo deverão ser formalizadas por escrito.

Teresina (PI), ${new Date().toLocaleDateString("pt-BR")}.

______________________________          ______________________________
        CONTRATANTE                               SUED Eventos`
  );
}

export async function renderContratos() {
  const container = el("div", {});

  async function loadList() {
    container.replaceChildren(el("div", { class: "center-screen", style: "height:200px" }, [el("div", { class: "spinner" })]));
    const contratos = await api.get("/contratos");
    const novo = el("button", { class: "btn btn--primary", html: `${icon("plus", 16)}<span>Novo contrato</span>` });
    novo.onclick = () => openEditor(null);

    const table = renderTable({
      columns: [
        { header: "Número", render: (r) => {
          const link = el("span", { class: "link-strong", style: "cursor:pointer" }, r.number);
          link.onclick = () => openEditor(r.id);
          return link;
        } },
        { header: "Cliente", render: (r) => r.clientName || "—" },
        { header: "Evento", render: (r) => r.eventTitle || "—" },
        { header: "Valor", align: "right", render: (r) => formatBRL(r.valueCents) },
        { header: "Assinado em", render: (r) => r.signedAt ? formatDate(r.signedAt) : "—" },
        { header: "Status", render: (r) => { const s = STATUS[r.status] || {}; return el("span", { class: `badge ${s.cls}` }, s.label || r.status); } },
      ],
      rows: contratos,
      empty: { title: "Nenhum contrato", desc: "Gere contratos a partir dos eventos e clientes." },
    });

    container.replaceChildren(
      el("div", { class: "page-header" }, [
        el("div", {}, [el("h1", {}, "Contratos"), el("p", {}, "Contratos e condições — vinculados a clientes e eventos.")]),
        novo,
      ]),
      el("div", { class: "card" }, [table]),
    );
  }

  async function openEditor(id) {
    container.replaceChildren(el("div", { class: "center-screen", style: "height:200px" }, [el("div", { class: "spinner" })]));
    const opts = await api.get("/contratos/opcoes");
    const ct = id ? await api.get(`/contratos/${id}`) : { status: "RASCUNHO", valueCents: 0 };
    const isEdit = !!id;

    const header = el("form", { class: "form-grid" }, [
      field("Cliente", "clientId", ct.clientId || "", { type: "select", options: [
        { value: "", label: "—" }, ...opts.clients.map((c) => ({ value: c.id, label: c.name })),
      ] }),
      field("Evento", "eventId", ct.eventId || "", { type: "select", options: [
        { value: "", label: "—" }, ...opts.events.map((e) => ({ value: e.id, label: e.title })),
      ] }),
      field("Valor (R$)", "value", ct.valueCents ? (ct.valueCents / 100).toFixed(2).replace(".", ",") : "", { placeholder: "0,00" }),
      field("Status", "status", ct.status || "RASCUNHO", { type: "select", options: Object.entries(STATUS).map(([v, s]) => ({ value: v, label: s.label })) }),
    ]);

    const content = el("textarea", { class: "textarea", style: "min-height:320px;font-family:ui-monospace,monospace;font-size:12.5px;line-height:1.6" }, ct.content || "");

    const gerar = el("button", { class: "btn btn--outline btn--sm", type: "button" }, "Gerar minuta base");
    gerar.onclick = () => {
      const clientName = opts.clients.find((c) => c.id === header.querySelector("[name=clientId]").value)?.name;
      const eventTitle = opts.events.find((e) => e.id === header.querySelector("[name=eventId]").value)?.title;
      const val = (() => { const v = header.querySelector("[name=value]").value; return v ? Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100) : 0; })();
      if (content.value.trim() && !confirm("Substituir o conteúdo atual pela minuta base?")) return;
      content.value = minuta(clientName, eventTitle, val);
    };

    const voltar = el("button", { class: "btn btn--ghost", html: `${icon("x", 15)}<span>Voltar</span>` });
    voltar.onclick = loadList;
    const salvar = el("button", { class: "btn btn--primary" }, isEdit ? "Salvar contrato" : "Criar contrato");
    salvar.onclick = async () => {
      const body = Object.fromEntries(new FormData(header));
      body.content = content.value;
      salvar.disabled = true;
      try {
        if (isEdit) await api.put(`/contratos/${id}`, body);
        else await api.post("/contratos", body);
        toast("Contrato salvo.");
        loadList();
      } catch (err) { toast(err.message, "error"); salvar.disabled = false; }
    };
    const actions = [voltar, salvar];
    if (isEdit) {
      const del = el("button", { class: "btn btn--danger" }, "Excluir");
      del.onclick = async () => { if (confirm(`Excluir o contrato ${ct.number}?`)) { try { await api.del(`/contratos/${id}`); toast("Contrato excluído."); loadList(); } catch (e) { toast(e.message, "error"); } } };
      actions.unshift(del);
    }

    container.replaceChildren(
      el("div", { class: "page-header" }, [
        el("div", {}, [el("h1", {}, isEdit ? `Contrato ${ct.number}` : "Novo contrato"), el("p", {}, "Dados e condições contratuais.")]),
        el("div", { class: "flex items-center gap-2" }, actions),
      ]),
      el("div", { class: "card card--pad", style: "margin-bottom:16px" }, [header]),
      el("div", { class: "card card--pad" }, [
        el("div", { class: "flex items-center justify-between", style: "margin-bottom:10px" }, [
          el("h2", { style: "font-size:14px;font-weight:600" }, "Condições do contrato"), gerar,
        ]),
        content,
      ]),
    );
  }

  await loadList();
  return container;
}
