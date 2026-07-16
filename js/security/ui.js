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
        const cell = c.render ? c.render(r) : (r[c.key] ?? "—");
        return el("td", {}, [cell]);
      })));
    }
  }
  return el("div", { class: "sec-table-wrap" }, [el("table", { class: "sec-table" }, [thead, tbody])]);
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
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleString();
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
