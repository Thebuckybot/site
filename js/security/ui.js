// Reusable UI helpers: DOM builder, toasts, modals, confirm dialogs, tables,
// pagination, badges, skeletons, and formatting. Used by every page so look,
// feel and behaviour stay consistent and pages stay small.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    // Skip nullish / false (allows `cond && el(...)`), coerce any non-Node
    // primitive (number, boolean, string) to a text node, and only append real
    // Nodes. This is the render-contract fix for the "appendChild must be an
    // instance of Node" crash caused by a render/child returning e.g. a number.
    if (c == null || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function toast(message, kind = "ok") {
  const host = document.getElementById("sec-toast-host");
  if (!host) { console.warn("[toast]", message); return; }   // FIN-002 L6: no shell -> don't crash
  const t = el("div", { class: `sec-toast ${kind}`, text: message });
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 250); }, 3200);
}

export function loading(root, msg = "Loading…") {
  clear(root);
  const wrap = el("div", { class: "sec-grid sec-grid-3" });
  for (let i = 0; i < 6; i++) wrap.appendChild(el("div", { class: "sec-card" }, [el("div", { class: "sec-skel", style: "width:60%" }), el("div", { class: "sec-skel", style: "margin-top:10px;height:28px" })]));
  root.appendChild(el("div", { class: "sec-muted", style: "margin-bottom:10px", text: msg }));
  root.appendChild(wrap);
}

export function empty(root, msg = "Nothing here yet.") {
  root.appendChild(el("div", { class: "sec-empty", text: msg }));
}

// Informative empty state: a titled card with an explanation and an optional
// Configure action — used instead of showing "None" / "null" anywhere.
export function emptyCard({ title, message, actionLabel, onAction }) {
  const card = el("div", { class: "sec-card sec-empty-card" }, [
    el("div", { class: "sec-empty-title", text: title }),
    el("p", { class: "sec-muted", text: message }),
  ]);
  if (actionLabel && typeof onAction === "function") {
    card.appendChild(el("button", { class: "sec-btn sec-btn-primary sec-btn-sm", onclick: onAction, text: actionLabel }));
  }
  return card;
}

export function errorState(root, err, retry) {
  clear(root);
  err = err || {};
  // FIN-002 L2: honest, distinct states for 403 / 401 (session) / timeout / offline.
  const is401 = err.status === 401;
  const title = err.status === 403 ? "Access denied"
    : is401 ? "Session expired"
    : err.code === "timeout" ? "The backend is not responding"
    : err.code === "network" ? "Backend unreachable"
    : "Could not load";
  const msg = is401 ? "Your session has expired. Reload the page to sign in again."
    : (err.message || "Something went wrong.");
  const card = el("div", { class: "sec-card" }, [
    el("div", { class: "sec-page-title", text: title }),
    el("p", { class: "sec-muted", text: msg }),
  ]);
  if (is401) {
    card.appendChild(el("button", { class: "sec-btn sec-btn-primary", onclick: () => window.location.reload(), text: "Reload" }));
  } else if (retry) {
    card.appendChild(el("button", { class: "sec-btn sec-btn-primary", onclick: retry, text: "Retry" }));
  }
  root.appendChild(card);
}

export function pageHeader(title, sub) {
  return el("div", {}, [
    el("h1", { class: "sec-page-title", text: title }),
    sub ? el("p", { class: "sec-page-sub", text: sub }) : null,
  ]);
}

export function statCard(label, value) {
  return el("div", { class: "sec-card sec-stat" }, [
    el("span", { class: "label", text: label }),
    el("span", { class: "value", text: String(value) }),
  ]);
}

export function badge(text, kind = "muted") {
  return el("span", { class: `sec-badge ${kind}`, text });
}

// Accessible, pure-CSS info tooltip: an ⓘ icon that reveals `text` on hover/focus.
export function info(text) {
  if (!text) return document.createTextNode("");
  return el("span", { class: "sec-info", tabindex: "0", "aria-label": text, role: "note" }, [
    "ⓘ", el("span", { class: "sec-tip", text }),
  ]);
}

// A page/section title with a trailing info tooltip.
export function infoTitle(title, text, tag = "h1", cls = "sec-page-title") {
  return el(tag, { class: cls }, [title + " ", info(text)]);
}

export function toggle(checked, onChange) {
  const input = el("input", { type: "checkbox" });
  input.checked = !!checked;
  input.addEventListener("change", () => onChange(input.checked));
  return el("label", { class: "sec-switch" }, [input, el("span", { class: "track" })]);
}

export function table(columns, rows) {
  const thead = el("thead", {}, [el("tr", {}, columns.map((c) => el("th", { text: c.label })))]);
  const tbody = el("tbody", {});
  if (!rows.length) {
    tbody.appendChild(el("tr", {}, [el("td", { colspan: columns.length }, [el("div", { class: "sec-empty", text: "No records." })])]));
  } else {
    for (const r of rows) {
      tbody.appendChild(el("tr", {}, columns.map((c) => {
        // el() coerces strings/numbers/booleans to text and passes Nodes through,
        // so a render() returning any primitive is safe (never crashes appendChild).
        const cell = c.render ? c.render(r) : (r[c.key] ?? "-");
        return el("td", { "data-label": c.label }, [cell]);
      })));
    }
  }
  return el("div", { class: "sec-table-wrap sec-table-responsive" }, [el("table", { class: "sec-table" }, [thead, tbody])]);
}

export function pager(page, hasNext, onChange) {
  return el("div", { class: "sec-pager" }, [
    el("button", { class: "sec-btn sec-btn-sm", disabled: page <= 0, onclick: () => onChange(page - 1), text: "◀ Prev" }),
    el("span", { text: `Page ${page + 1}` }),
    el("button", { class: "sec-btn sec-btn-sm", disabled: !hasNext, onclick: () => onChange(page + 1), text: "Next ▶" }),
  ]);
}

// FIN-002 M2 — keyboard/AT-complete modals: Escape closes, Enter confirms/submits
// (never inside a textarea/select), Tab is trapped inside the dialog, focus moves
// in on open and is restored on close, and the dialog carries role/aria-modal.
function _trapTab(modal, e) {
  const f = modal.querySelectorAll('button, [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function _modalKeydown(modal, { onEscape, onEnter }) {
  return (e) => {
    if (e.key === "Escape") { e.preventDefault(); onEscape && onEscape(); return; }
    if (e.key === "Enter" && onEnter) {
      const t = e.target;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return; // allow newlines / option nav
      e.preventDefault(); onEnter(); return;
    }
    if (e.key === "Tab") _trapTab(modal, e);
  };
}

export function confirmDialog({ title, message, danger = false, confirmLabel = "Confirm" }) {
  return new Promise((resolve) => {
    const host = document.getElementById("sec-modal-host");
    if (!host) { resolve(window.confirm(`${title}\n\n${message}`)); return; }
    const prevFocus = document.activeElement;
    let keyHandler;
    const close = (val) => {
      if (keyHandler) document.removeEventListener("keydown", keyHandler, true);
      host.classList.remove("open"); host.setAttribute("aria-hidden", "true"); clear(host);
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (_) { /* detached */ } }
      resolve(val);
    };
    const okBtn = el("button", { class: `sec-btn ${danger ? "sec-btn-danger" : "sec-btn-primary"}`, onclick: () => close(true), text: confirmLabel });
    const modal = el("div", { class: "sec-modal", role: "dialog", "aria-modal": "true", "aria-label": title }, [
      el("h3", { text: title }),
      el("p", { class: "sec-muted", text: message }),
      el("div", { class: "sec-modal-actions" }, [
        el("button", { class: "sec-btn sec-btn-ghost", onclick: () => close(false), text: "Cancel" }),
        okBtn,
      ]),
    ]);
    keyHandler = _modalKeydown(modal, { onEscape: () => close(false), onEnter: () => close(true) });
    document.addEventListener("keydown", keyHandler, true);
    clear(host); host.appendChild(modal); host.classList.add("open"); host.setAttribute("aria-hidden", "false");
    okBtn.focus();
  });
}

export function formModal({ title, fields, submitLabel = "Save" }) {
  return new Promise((resolve) => {
    const host = document.getElementById("sec-modal-host");
    const inputs = {};
    const rows = fields.map((f) => {
      let input;
      if (f.type === "select") {
        input = el("select", { class: "sec-select" }, (f.options || []).map((o) => {
          const opt = el("option", { value: o.value, text: o.label });
          if (o.value === f.value) opt.selected = true;
          return opt;
        }));
      } else if (f.type === "textarea") {
        input = el("textarea", { class: "sec-input", rows: f.rows || 6, placeholder: f.placeholder || "" });
        input.value = f.value ?? "";
      } else {
        input = el("input", { class: "sec-input", type: f.type || "text", value: f.value ?? "", placeholder: f.placeholder || "" });
      }
      inputs[f.name] = input;
      return el("div", { class: "row" }, [el("label", { text: f.label }), input]);
    });
    const prevFocus = document.activeElement;
    let keyHandler;
    const close = (val) => {
      if (keyHandler) document.removeEventListener("keydown", keyHandler, true);
      host.classList.remove("open"); host.setAttribute("aria-hidden", "true"); clear(host);
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (_) { /* detached */ } }
      resolve(val);
    };
    const submit = () => {
      const out = {};
      for (const f of fields) out[f.name] = inputs[f.name].value;
      close(out);
    };
    const modal = el("div", { class: "sec-modal", role: "dialog", "aria-modal": "true", "aria-label": title }, [
      el("h3", { text: title }), ...rows,
      el("div", { class: "sec-modal-actions" }, [
        el("button", { class: "sec-btn sec-btn-ghost", onclick: () => close(null), text: "Cancel" }),
        el("button", { class: "sec-btn sec-btn-primary", onclick: submit, text: submitLabel }),
      ]),
    ]);
    keyHandler = _modalKeydown(modal, { onEscape: () => close(null), onEnter: submit });
    document.addEventListener("keydown", keyHandler, true);
    clear(host); host.appendChild(modal); host.classList.add("open"); host.setAttribute("aria-hidden", "false");
    const firstInput = modal.querySelector("input, textarea, select");
    if (firstInput) firstInput.focus();
  });
}

export function fmtTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleString();
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------------------------------------------------------------------------
// Dashboard UI V2 — additional components (APPENDED, additive). Nothing above
// is modified; table() keeps its original behaviour. New: alertBox, statusPill,
// tabs, accordion, progressBar, timeline, dropdown, tooltip, and an enhanced
// dataTable (sortable / searchable / sticky / responsive). All reuse el(),
// clear() and debounce() defined earlier in this module.
// ---------------------------------------------------------------------------

// One callout replacing sec-warn-banner / sec-readonly-banner /
// sec-premium-card / sec-warn-card. kind: info | ok | warn | danger | premium.
export function alertBox({ title, message, kind = "info", icon: ic } = {}) {
  const body = el("div", { class: "sec-alert-body" }, [
    title ? el("div", { class: "sec-alert-title", text: title }) : null,
    message ? (message instanceof Node ? message : el("div", { text: message })) : null,
  ]);
  return el("div", { class: `sec-alert ${kind}`, role: kind === "danger" ? "alert" : "note" }, [
    ic ? el("span", { class: "sec-alert-ic", "aria-hidden": "true" }, [ic]) : null,
    body,
  ]);
}

// Status indicator: coloured dot + label. tone: ok | warn | bad | brand | muted.
export function statusPill(label, tone = "muted") {
  return el("span", { class: `sec-pill ${tone}` }, [el("span", { class: "dot" }), el("span", { text: label })]);
}

// Tabs. items: [{ label, content: Node | () => Node }]. Keyboard: ←/→ move.
export function tabs(items, { initial = 0, onChange } = {}) {
  const panel = el("div", { class: "sec-tab-panel" });
  const btns = [];
  const select = (i) => {
    btns.forEach((b, j) => b.setAttribute("aria-selected", j === i ? "true" : "false"));
    clear(panel);
    const c = items[i] && items[i].content;
    if (c) panel.appendChild(typeof c === "function" ? c() : c);
    if (onChange) onChange(i, items[i]);
  };
  const bar = el("div", { class: "sec-tabs", role: "tablist" }, items.map((it, i) => {
    const b = el("button", { class: "sec-tab", role: "tab", type: "button", text: it.label, onclick: () => select(i) });
    b.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const n = (i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length;
        btns[n].focus(); select(n);
      }
    });
    btns.push(b); return b;
  }));
  const wrap = el("div", {}, [bar, panel]);
  select(initial);
  return wrap;
}

// Collapsible section. body: Node | () => Node. tone: "danger" | "warn" for the count chip.
export function accordion({ title, count, body, open = false, tone } = {}) {
  const bodyWrap = el("div", { class: "sec-acc-body" }, [typeof body === "function" ? body() : body]);
  const head = el("button", { class: "sec-acc-head", type: "button", "aria-expanded": open ? "true" : "false" }, [
    el("span", { text: title }),
    count != null ? el("span", { class: "sec-acc-count", text: String(count) }) : null,
    el("span", { class: "chev", html: "&#8250;" }),
  ]);
  const root = el("div", { class: `sec-acc${open ? " open" : ""}${tone ? " tone-" + tone : ""}` }, [head, bodyWrap]);
  head.addEventListener("click", () => {
    const isOpen = root.classList.toggle("open");
    head.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
  return root;
}

// Progress bar 0–100. tone: "" | "ok" | "warn".
export function progressBar(pct, tone = "") {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  return el("div", { class: `sec-progress ${tone}`, role: "progressbar",
    "aria-valuenow": String(Math.round(v)), "aria-valuemin": "0", "aria-valuemax": "100" },
    [el("span", { style: `width:${v}%` })]);
}

// Vertical timeline. items: [{ time, title, detail, tone }].
export function timeline(items) {
  return el("ul", { class: "sec-timeline" }, (items || []).map((it) =>
    el("li", { class: `sec-tl-item ${it.tone || ""}` }, [
      it.time ? el("div", { class: "sec-tl-time", text: it.time }) : null,
      el("div", { class: "sec-tl-title", text: it.title }),
      it.detail ? el("div", { class: "sec-muted", text: it.detail }) : null,
    ])));
}

// Dropdown menu. items: [{ label, onClick, danger }]. Closes on outside click.
export function dropdown(triggerLabel, items) {
  const menu = el("div", { class: "sec-menu", role: "menu" }, items.map((it) =>
    el("button", { class: `sec-menu-item ${it.danger ? "danger" : ""}`, type: "button", role: "menuitem", text: it.label,
      onclick: () => { menu.classList.remove("open"); it.onClick && it.onClick(); } })));
  const trigger = el("button", { class: "sec-btn sec-btn-sm", type: "button", "aria-haspopup": "true", "aria-expanded": "false",
    onclick: (e) => { e.stopPropagation(); const o = menu.classList.toggle("open"); trigger.setAttribute("aria-expanded", o ? "true" : "false"); } },
    [triggerLabel]);
  document.addEventListener("click", () => { menu.classList.remove("open"); trigger.setAttribute("aria-expanded", "false"); });
  return el("div", { class: "sec-menu-wrap" }, [trigger, menu]);
}

// Positional hover/focus tooltip wrapping any child.
export function tooltip(child, text) {
  return el("span", { class: "sec-tt", tabindex: "0" }, [
    child instanceof Node ? child : document.createTextNode(String(child)),
    el("span", { class: "sec-tt-pop", role: "tooltip", text }),
  ]);
}

// Enhanced table: click-to-sort headers (aria-sort), optional search box,
// sticky header, responsive stacked-card mode. Column shape is a superset of
// table()'s: { key, label, render, sortable?, sortValue? }. table() is untouched.
export function dataTable(columns, rows, opts = {}) {
  const { search = false, sticky = false, responsive = true, searchKeys } = opts;
  let sortIdx = -1, sortDir = 1, query = "";

  const host = el("div", {});
  const wrap = el("div", { class: "sec-table-wrap" + (sticky ? " sec-table-sticky" : "") + (responsive ? " sec-table-responsive" : "") });

  const render = () => {
    let data = rows.slice();
    if (query) {
      const q = query.toLowerCase();
      const keys = searchKeys || columns.map((c) => c.key).filter(Boolean);
      data = data.filter((r) => keys.some((k) => String(r[k] ?? "").toLowerCase().includes(q)));
    }
    if (sortIdx >= 0) {
      const col = columns[sortIdx];
      data.sort((a, b) => {
        const av = col.sortValue ? col.sortValue(a) : a[col.key];
        const bv = col.sortValue ? col.sortValue(b) : b[col.key];
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av > bv ? 1 : av < bv ? -1 : 0) * sortDir;
      });
    }
    const thead = el("thead", {}, [el("tr", {}, columns.map((c, i) => {
      const sortable = c.sortable !== false && (c.key || c.sortValue);
      const th = el("th", sortable ? { class: "sortable", role: "button", tabindex: "0",
        "aria-sort": sortIdx === i ? (sortDir === 1 ? "ascending" : "descending") : "none" } : {},
        [c.label, sortable ? el("span", { class: "sort-ind", text: sortIdx === i ? (sortDir === 1 ? "▲" : "▼") : "↕" }) : null]);
      if (sortable) {
        const onSort = () => { if (sortIdx === i) sortDir *= -1; else { sortIdx = i; sortDir = 1; } render(); };
        th.addEventListener("click", onSort);
        th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort(); } });
      }
      return th;
    }))]);
    const tbody = el("tbody", {});
    if (!data.length) {
      tbody.appendChild(el("tr", {}, [el("td", { colspan: columns.length }, [el("div", { class: "sec-empty", text: query ? "No matches." : "No records." })])]));
    } else {
      for (const r of data) {
        tbody.appendChild(el("tr", {}, columns.map((c) => {
          const cell = c.render ? c.render(r) : (r[c.key] ?? "-");
          return el("td", { "data-label": c.label }, [cell]);
        })));
      }
    }
    clear(wrap);
    wrap.appendChild(el("table", { class: "sec-table" }, [thead, tbody]));
  };

  if (search) {
    const box = el("input", { class: "sec-input", type: "search", placeholder: "Search…", "aria-label": "Search table" });
    box.addEventListener("input", debounce((e) => { query = e.target.value || ""; render(); }, 200));
    host.appendChild(el("div", { class: "sec-toolbar" }, [box]));
  }
  host.appendChild(wrap);
  render();
  return host;
}
