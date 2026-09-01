// View Operacional: por evento — tarefas, checklists e cronograma.
import { api } from "../api.js";
import { el, formatDate } from "../utils.js";
import { icon } from "../components/icons.js";
import { toast } from "../components/toast.js";

const TASK_STATUS = {
  A_FAZER: { label: "A fazer", cls: "badge--muted" },
  EM_ANDAMENTO: { label: "Em andamento", cls: "badge--info" },
  CONCLUIDA: { label: "Concluída", cls: "badge--success" },
  BLOQUEADA: { label: "Bloqueada", cls: "badge--danger" },
};
const TASK_PRIORITY = {
  BAIXA: "Baixa", MEDIA: "Média", ALTA: "Alta", URGENTE: "Urgente",
};

export async function renderOperacional() {
  const container = el("div", {});
  const events = await api.get("/operacional/eventos");

  const panel = el("div", {});
  let currentEventId = events[0]?.id || "";

  const selector = el("select", { class: "select", style: "max-width:340px" }, [
    el("option", { value: "" }, events.length ? "Selecione um evento…" : "Nenhum evento cadastrado"),
    ...events.map((e) => el("option", { value: e.id }, `${e.title}${e.clientName ? " · " + e.clientName : ""}`)),
  ]);
  selector.value = currentEventId;
  selector.onchange = () => { currentEventId = selector.value; loadPanel(); };

  async function loadPanel() {
    if (!currentEventId) { panel.replaceChildren(el("div", { class: "empty", style: "padding:48px;text-align:center" }, [
      el("p", { class: "empty__title" }, "Selecione um evento"),
      el("p", { class: "empty__desc" }, "Escolha um evento acima para gerenciar tarefas, checklists e cronograma."),
    ])); return; }
    panel.replaceChildren(el("div", { class: "center-screen", style: "height:200px" }, [el("div", { class: "spinner" })]));
    const data = await api.get(`/operacional/evento/${currentEventId}`);
    panel.replaceChildren(el("div", { class: "grid", style: "grid-template-columns:1fr 1fr;gap:16px;align-items:start" }, [
      tasksCard(data), scheduleCard(data),
    ]), checklistsCard(data));
  }

  // ---- Tarefas ----
  function tasksCard(data) {
    const list = el("div", {});
    if (data.tasks.length) {
      list.append(...data.tasks.map((t) => {
        const stSel = el("select", { class: "select select--mini" },
          Object.entries(TASK_STATUS).map(([v, s]) => { const o = el("option", { value: v }, s.label); if (v === t.status) o.selected = true; return o; }));
        stSel.onchange = async () => { try { await api.patch(`/operacional/tarefas/${t.id}`, { status: stSel.value }); } catch (e) { toast(e.message, "error"); } };
        const del = el("button", { class: "btn btn--icon btn--ghost", html: icon("trash", 15) });
        del.onclick = async () => { try { await api.del(`/operacional/tarefas/${t.id}`); loadPanel(); } catch (e) { toast(e.message, "error"); } };
        return el("div", { class: "op-item" }, [
          el("div", { style: "flex:1" }, [
            el("p", { style: "font-weight:500;font-size:13px" }, t.title),
            el("p", { class: "text-muted", style: "font-size:12px" }, [
              `Prioridade ${TASK_PRIORITY[t.priority]}`,
              t.assigneeName && ` · ${t.assigneeName}`,
              t.dueDate && ` · vence ${formatDate(t.dueDate)}`,
            ].filter(Boolean).join("")),
          ]),
          stSel, del,
        ]);
      }));
    } else list.append(el("p", { class: "text-muted", style: "font-size:13px;padding:8px 0" }, "Nenhuma tarefa."));

    const title = el("input", { class: "input input--mini", placeholder: "Nova tarefa…", style: "flex:1" });
    const prio = el("select", { class: "select select--mini" }, Object.entries(TASK_PRIORITY).map(([v, l]) => { const o = el("option", { value: v }, l); if (v === "MEDIA") o.selected = true; return o; }));
    const assignee = el("select", { class: "select select--mini" }, [el("option", { value: "" }, "Responsável"), ...data.users.map((u) => el("option", { value: u.id }, u.name))]);
    const add = el("button", { class: "btn btn--subtle btn--sm", html: icon("plus", 15) });
    add.onclick = async () => {
      if (!title.value.trim()) return;
      try { await api.post("/operacional/tarefas", { eventId: currentEventId, title: title.value, priority: prio.value, assigneeId: assignee.value }); loadPanel(); }
      catch (e) { toast(e.message, "error"); }
    };
    return el("div", { class: "card card--pad" }, [
      el("h2", { class: "op-title", html: `${icon("clipboard", 16)}<span>Tarefas</span>` }),
      list,
      el("div", { class: "flex items-center", style: "gap:6px;margin-top:12px;flex-wrap:wrap" }, [title, prio, assignee, add]),
    ]);
  }

  // ---- Cronograma ----
  function scheduleCard(data) {
    const list = el("div", {});
    if (data.schedule.length) {
      list.append(...data.schedule.map((s) => {
        const del = el("button", { class: "btn btn--icon btn--ghost", html: icon("trash", 15) });
        del.onclick = async () => { try { await api.del(`/operacional/cronograma/${s.id}`); loadPanel(); } catch (e) { toast(e.message, "error"); } };
        return el("div", { class: "op-item" }, [
          el("div", { style: "flex:1" }, [
            el("p", { style: "font-weight:500;font-size:13px" }, s.title),
            el("p", { class: "text-muted", style: "font-size:12px" }, [
              formatDate(s.startsAt, true), s.endsAt && ` – ${formatDate(s.endsAt, true)}`, s.location && ` · ${s.location}`,
            ].filter(Boolean).join("")),
          ]),
          del,
        ]);
      }));
    } else list.append(el("p", { class: "text-muted", style: "font-size:13px;padding:8px 0" }, "Sem itens no cronograma."));

    const title = el("input", { class: "input input--mini", placeholder: "Etapa…", style: "flex:1" });
    const startsAt = el("input", { class: "input input--mini", type: "datetime-local" });
    const location = el("input", { class: "input input--mini", placeholder: "Local", style: "max-width:120px" });
    const add = el("button", { class: "btn btn--subtle btn--sm", html: icon("plus", 15) });
    add.onclick = async () => {
      if (!title.value.trim() || !startsAt.value) return toast("Informe etapa e horário de início.", "error");
      try { await api.post("/operacional/cronograma", { eventId: currentEventId, title: title.value, startsAt: startsAt.value, location: location.value }); loadPanel(); }
      catch (e) { toast(e.message, "error"); }
    };
    return el("div", { class: "card card--pad" }, [
      el("h2", { class: "op-title", html: `${icon("calendar", 16)}<span>Cronograma</span>` }),
      list,
      el("div", { class: "flex items-center", style: "gap:6px;margin-top:12px;flex-wrap:wrap" }, [title, startsAt, location, add]),
    ]);
  }

  // ---- Checklists ----
  function checklistsCard(data) {
    const wrap = el("div", { class: "card card--pad", style: "margin-top:16px" });
    const lists = el("div", { class: "grid", style: "grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px" });

    for (const cl of data.checklists) {
      const done = cl.items.filter((i) => i.done).length;
      const itemsBox = el("div", {});
      itemsBox.append(...cl.items.map((it) => {
        const cb = el("input", { type: "checkbox" }); cb.checked = it.done;
        cb.onchange = async () => { try { await api.patch(`/operacional/checklists/itens/${it.id}`, { done: cb.checked }); loadPanel(); } catch (e) { toast(e.message, "error"); } };
        const del = el("button", { class: "btn btn--icon btn--ghost", html: icon("x", 13), style: "width:24px;height:24px" });
        del.onclick = async () => { try { await api.del(`/operacional/checklists/itens/${it.id}`); loadPanel(); } catch (e) { toast(e.message, "error"); } };
        return el("label", { class: "flex items-center", style: "gap:8px;font-size:13px;padding:3px 0" }, [
          cb, el("span", { style: it.done ? "text-decoration:line-through;color:var(--sued-muted)" : "" }, it.label),
          el("span", { style: "flex:1" }), del,
        ]);
      }));
      const newItem = el("input", { class: "input input--mini", placeholder: "+ item", style: "margin-top:6px" });
      newItem.onkeydown = async (e) => {
        if (e.key === "Enter" && newItem.value.trim()) {
          try { await api.post(`/operacional/checklists/${cl.id}/itens`, { label: newItem.value }); loadPanel(); } catch (err) { toast(err.message, "error"); }
        }
      };
      const delList = el("button", { class: "btn btn--icon btn--ghost", html: icon("trash", 14) });
      delList.onclick = async () => { if (confirm(`Excluir checklist "${cl.title}"?`)) { try { await api.del(`/operacional/checklists/${cl.id}`); loadPanel(); } catch (e) { toast(e.message, "error"); } } };
      lists.append(el("div", { class: "checklist" }, [
        el("div", { class: "flex items-center justify-between", style: "margin-bottom:6px" }, [
          el("span", { style: "font-weight:600;font-size:13px" }, `${cl.title} (${done}/${cl.items.length})`), delList,
        ]),
        itemsBox, newItem,
      ]));
    }

    const newCl = el("input", { class: "input input--mini", placeholder: "Nome do checklist…", style: "max-width:260px" });
    const addCl = el("button", { class: "btn btn--subtle btn--sm" }, "Novo checklist");
    addCl.onclick = async () => { if (!newCl.value.trim()) return; try { await api.post("/operacional/checklists", { eventId: currentEventId, title: newCl.value }); loadPanel(); } catch (e) { toast(e.message, "error"); } };

    wrap.append(
      el("h2", { class: "op-title", html: `${icon("clipboard", 16)}<span>Checklists</span>` }),
      data.checklists.length ? lists : el("p", { class: "text-muted", style: "font-size:13px;padding:8px 0" }, "Nenhum checklist ainda."),
      el("div", { class: "flex items-center", style: "gap:8px;margin-top:14px" }, [newCl, addCl]),
    );
    return wrap;
  }

  container.replaceChildren(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("h1", {}, "Operacional"),
        el("p", {}, "Tarefas, checklists e cronograma de cada evento."),
      ]),
      selector,
    ]),
    panel,
  );
  await loadPanel();
  return container;
}
