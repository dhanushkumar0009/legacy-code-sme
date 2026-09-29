(() => {
  "use strict";

  const API_BASE = window.LEGACY_SME_API_BASE || "";

  // ---------- DOM ----------
  const el = (id) => document.getElementById(id);
  const app = el("app");
  const sidebar = el("sidebar");
  const memoryPanel = el("memoryPanel");
  const drawerBackdrop = el("drawerBackdrop");
  const viewTitle = el("viewTitle");
  const statusDot = el("statusDot");
  const statusText = el("statusText");
  const messagesEl = el("messages");
  const emptyChat = el("emptyChat");
  const typingIndicator = el("typingIndicator");
  const chatForm = el("chatForm");
  const chatInput = el("chatInput");
  const userNameInput = el("userName");
  const sendBtn = el("sendBtn");
  const settingsName = el("settingsName");
  const settingsApiBase = el("settingsApiBase");
  const settingsStatus = el("settingsStatus");

  const VIEW_TITLES = {
    overview: "Overview",
    assistant: "AI Assistant",
    explorer: "Code Explorer",
    memoryview: "Memory",
    analysis: "Analysis",
    settings: "Settings",
  };

  // ---------- STATE ----------
  const state = {
    entities: [],
    history: [], // [{role, content}]
    filter: "ALL",
    activeView: "overview",
    selectedEntity: null,
  };

  // ---------- MARKDOWN ----------
  function renderMarkdown(text) {
    let html;
    try {
      html = window.marked ? window.marked.parse(text) : escapeHtml(text);
    } catch (e) {
      html = escapeHtml(text);
    }
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    wrapper.querySelectorAll("pre code").forEach((block) => {
      if (window.hljs) {
        try { window.hljs.highlightElement(block); } catch (e) { /* ignore */ }
      }
      const pre = block.parentElement;
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.type = "button";
      btn.textContent = "Copy";
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(block.textContent).then(() => {
          btn.textContent = "Copied";
          setTimeout(() => (btn.textContent = "Copy"), 1400);
        });
      });
      pre.appendChild(btn);
    });
    return wrapper;
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ---------- NAV ----------
  function setActiveView(view) {
    state.activeView = view;
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === view);
    });
    document.querySelectorAll(".view").forEach((section) => {
      section.classList.toggle("active", section.id === "view-" + view);
    });
    viewTitle.textContent = VIEW_TITLES[view] || "";

    if (view === "memoryview") {
      openMemoryDrawer();
    }
    closeSidebarDrawer();
  }

  document.getElementById("nav").addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-item");
    if (!btn) return;
    setActiveView(btn.dataset.view);
  });

  // ---------- SIDEBAR COLLAPSE (desktop) ----------
  el("sidebarCollapse").addEventListener("click", () => {
    app.classList.toggle("sidebar-collapsed");
  });

  // ---------- MOBILE DRAWERS ----------
  function openSidebarDrawer() {
    sidebar.classList.add("open");
    drawerBackdrop.classList.add("open");
  }
  function closeSidebarDrawer() {
    sidebar.classList.remove("open");
    if (!memoryPanel.classList.contains("open")) drawerBackdrop.classList.remove("open");
  }
  function openMemoryDrawer() {
    memoryPanel.classList.add("open");
    drawerBackdrop.classList.add("open");
  }
  function closeMemoryDrawer() {
    memoryPanel.classList.remove("open");
    if (!sidebar.classList.contains("open")) drawerBackdrop.classList.remove("open");
  }

  el("menuToggle").addEventListener("click", openSidebarDrawer);
  el("memoryToggle").addEventListener("click", openMemoryDrawer);
  el("memoryClose").addEventListener("click", closeMemoryDrawer);
  drawerBackdrop.addEventListener("click", () => {
    closeSidebarDrawer();
    closeMemoryDrawer();
  });

  // ---------- MEMORY FILTERS ----------
  el("memoryFilters").addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip) return;
    state.filter = chip.dataset.filter;
    document.querySelectorAll(".filter-chip").forEach((c) => c.classList.toggle("active", c === chip));
    renderMemoryList();
  });

  // ---------- RENDERING: MEMORY / METRICS / HEALTH ----------
  function badgeCounts() {
    const counts = { CONFIRMED: 0, INFERRED: 0, STALE: 0 };
    state.entities.forEach((e) => {
      if (counts[e.badge] !== undefined) counts[e.badge]++;
    });
    return counts;
  }

  function renderMetrics() {
    const counts = badgeCounts();
    el("metricMethods").textContent = state.entities.length || (state.entities.length === 0 ? "0" : "—");
    el("metricClasses").textContent = "—";
    el("metricConfirmed").textContent = counts.CONFIRMED;
    el("metricInferred").textContent = counts.INFERRED;
    el("metricStale").textContent = counts.STALE;
  }

  function healthBarsMarkup(counts, total) {
    if (!total) return '<div class="empty-state">No entities tracked yet — ingest a repo to see memory health.</div>';
    return ["CONFIRMED", "INFERRED", "STALE"]
      .map((key) => {
        const pct = total ? Math.round((counts[key] / total) * 100) : 0;
        return `
          <div class="health-row">
            <span class="health-label">${key}</span>
            <div class="health-track"><div class="health-fill ${key}" style="width:${pct}%"></div></div>
            <span class="health-count">${counts[key]}</span>
          </div>`;
      })
      .join("");
  }

  function renderHealth() {
    const counts = badgeCounts();
    const total = state.entities.length;
    const markup = healthBarsMarkup(counts, total);
    el("healthBars").innerHTML = markup;
    el("analysisHealthBars").innerHTML = markup;
  }

  function formatDate(ts) {
    if (!ts) return null;
    try { return new Date(ts * 1000).toLocaleString(); } catch (e) { return null; }
  }

  function entityCardMarkup(e) {
    const validated = e.validated_by ? `Validated by ${escapeHtml(e.validated_by)}` : "Not yet validated";
    const changed = formatDate(e.last_code_changed_at);
    return `
      <div class="entity-card" data-entity="${escapeHtml(e.entity)}">
        <div class="name">${escapeHtml(e.entity)}</div>
        <span class="badge ${e.badge}">${e.badge}</span>
        <div class="meta">${validated}${changed ? " · code seen " + changed : ""}</div>
      </div>`;
  }

  function renderMemoryList() {
    const filtered = state.filter === "ALL" ? state.entities : state.entities.filter((e) => e.badge === state.filter);
    if (!filtered.length) {
      el("memoryList").innerHTML = `<div class="empty-state">${
        state.entities.length ? "No entities match this filter." : "No entities tracked yet — ingest the sample repo first."
      }</div>`;
      return;
    }
    el("memoryList").innerHTML = filtered.map(entityCardMarkup).join("");
  }

  function renderExplorerList() {
    if (!state.entities.length) {
      el("explorerEntities").innerHTML = '<div class="empty-state">No entities tracked yet.</div>';
      return;
    }
    el("explorerEntities").innerHTML = state.entities
      .map(
        (e) => `
        <div class="entity-row${state.selectedEntity === e.entity ? " active" : ""}" data-entity="${escapeHtml(e.entity)}">
          <span class="entity-row-name">${escapeHtml(e.entity)}</span>
          <span class="badge ${e.badge}">${e.badge}</span>
        </div>`
      )
      .join("");
  }

  function renderExplorerDetail() {
    const detail = el("explorerDetail");
    const entity = state.entities.find((e) => e.entity === state.selectedEntity);
    if (!entity) {
      detail.innerHTML = '<div class="empty-state">Select an entity on the left to inspect it.</div>';
      return;
    }
    const validated = entity.validated_by ? `Validated by ${escapeHtml(entity.validated_by)}` : "Not yet validated";
    const changed = formatDate(entity.last_code_changed_at);
    const confirmedAt = formatDate(entity.last_validated_at);
    detail.innerHTML = `
      <span class="badge-inline ${entity.badge}">${entity.badge}</span>
      <div class="detail-title">${escapeHtml(entity.entity)}</div>
      <div class="detail-meta">${validated}${confirmedAt ? " · confirmed " + confirmedAt : ""}${changed ? " · code seen " + changed : ""}</div>

      <div class="detail-section-label">Business Logic</div>
      <div class="detail-body" id="explainBody">
        <button class="explain-btn" id="explainBtn" type="button">Ask LegacyLens to explain this</button>
      </div>

      <div class="detail-section-label">Source</div>
      <div class="source-placeholder">Source snippet not available from the current API — the backend doesn't expose raw file contents yet. Wire up a source-lookup endpoint to show code inline here.</div>
    `;
    const btn = el("explainBtn");
    if (btn) {
      btn.addEventListener("click", () => explainEntity(entity.entity, el("explainBody")));
    }
  }

  async function explainEntity(entityName, target) {
    target.innerHTML = '<div class="empty-state" style="padding:8px 0;text-align:left;">Asking LegacyLens…</div>';
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `What does ${entityName} do?`,
          user_name: userNameInput.value || "unknown reviewer",
          history: [],
        }),
      });
      const data = await res.json();
      target.innerHTML = "";
      target.appendChild(renderMarkdown(data.reply || data.detail || "(no reply)"));
    } catch (e) {
      target.innerHTML = `<div class="empty-state" style="padding:8px 0;text-align:left;color:var(--stale)">Could not reach backend: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderStaleList() {
    const stale = state.entities.filter((e) => e.badge === "STALE");
    if (!stale.length) {
      el("staleList").innerHTML = '<div class="empty-state">Nothing stale right now.</div>';
      return;
    }
    el("staleList").innerHTML = stale.map(entityCardMarkup).join("");
  }

  function renderAll() {
    renderMetrics();
    renderHealth();
    renderMemoryList();
    renderExplorerList();
    renderExplorerDetail();
    renderStaleList();
  }

  // click on entity rows / cards anywhere -> select + jump to explorer
  document.addEventListener("click", (e) => {
    const row = e.target.closest(".entity-row, .entity-card");
    if (!row) return;
    const entity = row.dataset.entity;
    if (!entity) return;
    state.selectedEntity = entity;
    setActiveView("explorer");
    renderExplorerList();
    renderExplorerDetail();
  });

  // ---------- MEMORIES POLLING ----------
  async function refreshMemories() {
    try {
      const res = await fetch(`${API_BASE}/memories`);
      const data = await res.json();
      state.entities = data.entities || [];
      renderAll();
    } catch (e) {
      el("memoryList").innerHTML = '<div class="empty-state">Could not reach backend.</div>';
    }
  }

  // ---------- HEALTH POLLING ----------
  async function checkHealth() {
    try {
      const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
      if (res.ok) {
        statusDot.className = "status-dot ok";
        statusText.textContent = "Claude Connected";
        settingsStatus.textContent = "Connected";
      } else {
        throw new Error("bad status");
      }
    } catch (e) {
      statusDot.className = "status-dot bad";
      statusText.textContent = "Backend unreachable";
      settingsStatus.textContent = "Unreachable";
    }
  }

  // ---------- CHAT ----------
  function addMessage(role, text) {
    emptyChat.style.display = "none";
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    if (role === "assistant") {
      const badgeMatch = text.match(/\b(CONFIRMED|INFERRED|STALE)\b/);
      if (badgeMatch) {
        const b = document.createElement("span");
        b.className = "badge-inline " + badgeMatch[1];
        b.textContent = badgeMatch[1];
        wrap.appendChild(b);
        wrap.appendChild(document.createElement("br"));
      }
      wrap.appendChild(renderMarkdown(text));
    } else if (role === "error") {
      wrap.textContent = text;
    } else {
      wrap.textContent = text;
    }
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function sendMessage(text) {
    const message = (text !== undefined ? text : chatInput.value).trim();
    if (!message) return;
    chatInput.value = "";
    sendBtn.disabled = true;
    typingIndicator.hidden = false;
    addMessage("user", message);
    state.history.push({ role: "user", content: message });

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          user_name: userNameInput.value || "unknown reviewer",
          history: state.history,
        }),
      });
      const data = await res.json();
      const reply = data.reply || data.detail || "(no reply)";
      addMessage("assistant", reply);
      state.history.push({ role: "assistant", content: reply });
    } catch (e) {
      addMessage("error", "Error reaching backend: " + e.message);
    } finally {
      sendBtn.disabled = false;
      typingIndicator.hidden = true;
      refreshMemories();
    }
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage();
  });

  el("suggestedQuestions").addEventListener("click", (e) => {
    const btn = e.target.closest(".suggestion");
    if (!btn) return;
    sendMessage(btn.textContent);
  });

  // ---------- SETTINGS <-> NAME SYNC ----------
  settingsApiBase.textContent = API_BASE || "(same origin)";
  settingsName.value = userNameInput.value;
  settingsName.addEventListener("input", () => (userNameInput.value = settingsName.value));
  userNameInput.addEventListener("input", () => (settingsName.value = userNameInput.value));

  // ---------- INIT ----------
  refreshMemories();
  checkHealth();
  setInterval(refreshMemories, 8000);
  setInterval(checkHealth, 15000);
})();
