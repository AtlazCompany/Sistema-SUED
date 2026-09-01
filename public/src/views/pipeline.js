// View do Funil comercial (Oportunidades): kanban por estágio,
// criar/editar, mover estágio e detalhe com histórico de interações.
import { api } from "../api.js";
import { el, formatBRL, formatDate } from "../utils.js";
import { icon } from "../components/icons.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { field, centsToInput } from "../components/form.js";

const STAGES = {
  PROSPECCAO: "Prospecção",
  QUALIFICACAO: "Qualificação",
  PROPOSTA: "Proposta",
  NEGOCIACAO: "Negociação",
  GANHO: "Ganho",
  PERDIDO: "Perdido",
};

const INTERACTION_TYPES = {
  NOTA: "Nota", LIGACAO: "Ligação", REUNIAO: "Reunião",
  EMAIL: "E-mail", WHATSAPP: "WhatsApp", VISITA: "Visita",
};

// ---------- Formulário criar/editar ----------
async function oppForm(opp, onSaved) {
  const isEdit = !!opp;
  const o = opp || {};
  const [clients, users] = await Promise.all([
    api.get("/clientes"),
    api.get("/usuarios/opcoes"),
  ]);
  if (!clients.length) return toast("Cadastre um cliente antes de criar oportunidades.", "error");

  const expected = o.expectedDate ? String(o.expectedDate).slice(0, 10) : "";
  const form = el("form", { class: "form-grid" }, [
    field("Título", "title", o.title, { required: true, col2: true, placeholder: "Ex.: Casamento Marina & João" }),
    field("Cliente", "clientId", o.clientId || "", { type: "select", required: true, options: [
      { value: "", label: "Selecione…" },
      ...clients.map((c) => ({ value: c.id, label: c.name })),
    ] }),
    field("Responsável", "ownerId", o.ownerId || "", { type: "select", options: [
      { value: "", label: "—" },
      ...users.map((u) => ({ value: u.id, label: u.name })),
    ] }),
    field("Estágio", "stage", o.stage || "PROSPECCAO", { type: "select", options:
      Object.entries(STAGES).map(([value, label]) => ({ value, label })) }),
    field("Valor estimado (R$)", "estimated", centsToInput(o.estimatedCents), { placeholder: "0,00" }),
    field("Previsão de fechamento", "expectedDate", expected, { type: "date" }),
    field("Observações", "notes", o.notes, { type: "textarea", col2: true }),
  ]);

  const save = el("button", { class: "btn btn--primary", type: "button" }, isEdit ? "Salvar" : "Criar oportunidade");
  const cancel = el("button", { class: "btn btn--ghost", type: "button" }, "Cancelar");
  const modal = openModal({ title: isEdit ? "Editar oportunidade" : "Nova oportunidade", body: form, footer: [cancel, save] });
  cancel.onclick = modal.close;

  save.onclick = async () => {
    const body = Object.fromEntries(new FormData(form));
    if (!body.title?.trim()) return toast("Informe um título.", "error");
    if (!body.clientId) return toast("Selecione um cliente.", "error");
    save.disabled = true;
    try {
      if (isEdit) await api.put(`/oportunidades/${o.id}`, body);
      else await api.post("/oportunidades", body);
      modal.close();
      toast(isEdit ? "Oportunidade atualizada." : "Oportunidade criada.");
      onSaved();
    } catch (err) {
      toast(err.message, "error");
      save.disabled = false;
    }
  };
}

// ---------- Detalhe + interações ----------
async function oppDetail(id, onChanged) {
  const o = await api.get(`/oportunidades/${id}`);

  const timeline = el("div", {});
  function renderTimeline(items) {
    timeline.replaceChildren(
      items.length
        ? el("ul", { class: "timeline" }, items.map((i) =>
            el("li", { class: "timeline__item" }, [
              el("div", { class: "timeline__meta" }, [
                el("span", { class: "timeline__type" }, INTERACTION_TYPES[i.type] || i.type),
                el("span", {}, ` · ${formatDate(i.createdAt, true)}`),
                i.userName && el("span", {}, ` · ${i.userName}`),
              ]),
              el("p", { class: "timeline__content" }, i.content),
            ])))
        : el("p", { class: "text-muted", style: "padding:8px 0" }, "Nenhuma interação registrada."),
    );
  }
  renderTimeline(o.interactions);

  // Registrar nova interação
  const typeSel = el("select", { class: "select", style: "max-width:140px" },
    Object.entries(INTERACTION_TYPES).map(([v, l]) => el("option", { value: v }, l)));
  const contentInput = el("textarea", { class: "textarea", placeholder: "Descreva a interação…", style: "min-height:44px" });
  const addBtn = el("button", { class: "btn btn--primary btn--sm", type: "button" }, "Registrar");
  addBtn.onclick = async () => {
    if (!contentInput.value.trim()) return toast("Descreva a interação.", "error");
    addBtn.disabled = true;
    try {
      await api.post(`/oportunidades/${o.id}/interacoes`, { type: typeSel.value, content: contentInput.value });
      const updated = await api.get(`/oportunidades/${id}`);
      renderTimeline(updated.interactions);
      contentInput.value = "";
    } catch (err) { toast(err.message, "error"); }
    addBtn.disabled = false;
  };

  const editBtn = el("button", { class: "btn btn--outline", type: "button", html: `${icon("edit", 15)}<span>Editar</span>` });
  const delBtn = el("button", { class: "btn btn--danger", type: "button", html: `${icon("trash", 15)}<span>Excluir</span>` });
  const closeBtn = el("button", { class: "btn btn--ghost", type: "button" }, "Fechar");

  const body = el("div", {}, [
    el("div", { class: "opp-summary" }, [
      el("div", { class: "opp-summary__row" }, [
        el("span", { class: "text-muted" }, "Cliente"),
        el("span", { style: "font-weight:500" }, o.clientName),
      ]),
      el("div", { class: "opp-summary__row" }, [
        el("span", { class: "text-muted" }, "Estágio"),
        el("span", { class: "badge badge--gold" }, STAGES[o.stage] || o.stage),
      ]),
      el("div", { class: "opp-summary__row" }, [
        el("span", { class: "text-muted" }, "Valor estimado"),
        el("span", { style: "font-weight:600" }, formatBRL(o.estimatedCents)),
      ]),
      el("div", { class: "opp-summary__row" }, [
        el("span", { class: "text-muted" }, "Previsão"),
        el("span", {}, o.expectedDate ? formatDate(o.expectedDate) : "—"),
      ]),
      el("div", { class: "opp-summary__row" }, [
        el("span", { class: "text-muted" }, "Responsável"),
        el("span", {}, o.ownerName || "—"),
      ]),
      o.notes && el("p", { class: "text-soft", style: "margin-top:10px;white-space:pre-wrap;font-size:13px" }, o.notes),
    ]),
    el("hr", { class: "sued-divider-gold", style: "margin:16px 0" }),
    el("h3", { style: "font-size:13px;font-weight:600;margin-bottom:10px" }, "Histórico de interações"),
    el("div", { class: "flex", style: "gap:8px;margin-bottom:6px" }, [typeSel, contentInput]),
    el("div", { style: "margin-bottom:14px" }, [addBtn]),
    timeline,
  ]);

  const modal = openModal({ title: o.title, body, footer: [delBtn, closeBtn, editBtn], wide: true });
  closeBtn.onclick = modal.close;
  editBtn.onclick = () => { modal.close(); oppForm(o, onChanged); };
  delBtn.onclick = async () => {
    if (!confirm(`Excluir a oportunidade "${o.title}"?`)) return;
    try { await api.del(`/oportunidades/${o.id}`); modal.close(); toast("Oportunidade excluída."); onChanged(); }
    catch (err) { toast(err.message, "error"); }
  };
}

// ---------- Board ----------
export async function renderPipeline() {
  const container = el("div", {});

  async function load() {
    container.replaceChildren(el("div", { class: "center-screen", style: "height:200px" }, [el("div", { class: "spinner" })]));
    const opps = await api.get("/oportunidades");

    const novo = el("button", { class: "btn btn--primary", html: `${icon("plus", 16)}<span>Nova oportunidade</span>` });
    novo.onclick = () => oppForm(null, load);

    const board = el("div", { class: "kanban" },
      Object.entries(STAGES).map(([stage, label]) => {
        const items = opps.filter((x) => x.stage === stage);
        const sum = items.reduce((a, x) => a + Number(x.estimatedCents || 0), 0);

        return el("div", { class: "kanban__col" }, [
          el("div", { class: "kanban__head" }, [
            el("span", { class: "kanban__title" }, label),
            el("span", { class: "kanban__count" }, String(items.length)),
          ]),
          el("div", { class: "kanban__sum" }, formatBRL(sum)),
          el("div", { class: "kanban__cards" }, [
            ...items.map((x) => {
              const stageSel = el("select", { class: "kanban__stage-sel" },
                Object.entries(STAGES).map(([v, l]) => {
                  const opt = el("option", { value: v }, l);
                  if (v === stage) opt.selected = true;
                  return opt;
                }));
              stageSel.onchange = async () => {
                try { await api.patch(`/oportunidades/${x.id}/estagio`, { stage: stageSel.value }); load(); }
                catch (err) { toast(err.message, "error"); }
              };
              stageSel.onclick = (e) => e.stopPropagation();

              const card = el("div", { class: "kanban__card" }, [
                el("p", { class: "kanban__card-title" }, x.title),
                el("p", { class: "kanban__card-client" }, x.clientName),
                el("p", { class: "kanban__card-value" }, formatBRL(x.estimatedCents)),
                stageSel,
              ]);
              card.onclick = () => oppDetail(x.id, load);
              return card;
            }),
            !items.length && el("div", { class: "kanban__empty" }, "Vazio"),
          ]),
        ]);
      }),
    );

    container.replaceChildren(
      el("div", { class: "page-header" }, [
        el("div", {}, [
          el("h1", {}, "Funil comercial"),
          el("p", {}, "Acompanhe cada oportunidade da prospecção ao fechamento."),
        ]),
        novo,
      ]),
      board,
    );
  }

  await load();
  return container;
}
