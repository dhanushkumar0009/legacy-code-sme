(() => {
  "use strict";

  // ============================================================
  // CONFIG
  // ============================================================

  const API_BASE = window.LEGACY_SME_API_BASE || "";

  // Keep the frontend from sending an ever-growing conversation.
  const MAX_HISTORY_MESSAGES = 12;

  // ============================================================
  // DOM
  // ============================================================

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

  // ============================================================
  // STATE
  // ============================================================

  const state = {
    entities: [],
    history: [],
    filter: "ALL",
    activeView: "overview",
    selectedEntity: null,
    backendOnline: false,
  };

  // ============================================================
  // HELPERS
  // ============================================================

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
  }

  function formatDate(timestamp) {
    if (!timestamp) return null;

    try {
      return new Date(timestamp * 1000).toLocaleString();
    } catch {
      return null;
    }
  }

  function isInternalErrorText(text) {
    if (!text) return false;

    const lower = text.toLowerCase();

    return (
      lower.includes("i ran out of reasoning steps") ||
      lower.includes("i ran out of reasoning") ||
      lower.includes("traceback") ||
      lower.includes("rate_limit_exceeded") ||
      lower.includes("tokens per minute")
    );
  }

  function friendlyChatError(status, data) {
    const detail =
      data?.detail ||
      data?.reply ||
      "";

    const text = String(detail).toLowerCase();

    if (
      status === 429 ||
      text.includes("rate limit") ||
      text.includes("rate_limit_exceeded") ||
      text.includes("tokens per minute")
    ) {
      return (
        "The AI service is temporarily rate-limited. " +
        "Please wait a few seconds and try again."
      );
    }

    if (status >= 500) {
      return (
        "LegacyLens couldn't complete that request. " +
        "Please try again."
      );
    }

    if (!status) {
      return (
        "I couldn't connect to the LegacyLens backend. " +
        "Please check that the service is running."
      );
    }

    return detail || "Something went wrong. Please try again.";
  }

  // ============================================================
  // MARKDOWN
  // ============================================================

  function renderMarkdown(text) {
    const safeText = String(text ?? "");

    let html;

    try {
      if (window.marked) {
        html = window.marked.parse(safeText);
      } else {
        html = escapeHtml(safeText).replace(/\n/g, "<br>");
      }
    } catch {
      html = escapeHtml(safeText).replace(/\n/g, "<br>");
    }

    const wrapper = document.createElement("div");
    wrapper.className = "markdown-content";
    wrapper.innerHTML = html;

    // Syntax highlighting
    wrapper.querySelectorAll("pre code").forEach((block) => {
      if (window.hljs) {
        try {
          window.hljs.highlightElement(block);
        } catch {
          // Highlighting failure should never break the response.
        }
      }

      const pre = block.parentElement;

      if (!pre || pre.querySelector(".copy-btn")) {
        return;
      }

      const copyButton = document.createElement("button");

      copyButton.className = "copy-btn";
      copyButton.type = "button";
      copyButton.textContent = "Copy";

      copyButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            block.textContent || ""
          );

          copyButton.textContent = "Copied";

          setTimeout(() => {
            copyButton.textContent = "Copy";
          }, 1400);

        } catch {
          copyButton.textContent = "Copy failed";

          setTimeout(() => {
            copyButton.textContent = "Copy";
          }, 1400);
        }
      });

      pre.appendChild(copyButton);
    });

    return wrapper;
  }

  // ============================================================
  // NAVIGATION
  // ============================================================

  function setActiveView(view) {
    state.activeView = view;

    document.querySelectorAll(".nav-item").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.view === view
      );
    });

    document.querySelectorAll(".view").forEach((section) => {
      section.classList.toggle(
        "active",
        section.id === `view-${view}`
      );
    });

    viewTitle.textContent =
      VIEW_TITLES[view] || "";

    if (view === "memoryview") {
      openMemoryDrawer();
    }

    closeSidebarDrawer();
  }

  el("nav").addEventListener("click", (event) => {
    const button =
      event.target.closest(".nav-item");

    if (!button) return;

    setActiveView(button.dataset.view);
  });

  // ============================================================
  // SIDEBAR
  // ============================================================

  el("sidebarCollapse").addEventListener(
    "click",
    () => {
      app.classList.toggle(
        "sidebar-collapsed"
      );
    }
  );

  // ============================================================
  // MOBILE DRAWERS
  // ============================================================

  function openSidebarDrawer() {
    sidebar.classList.add("open");
    drawerBackdrop.classList.add("open");
  }

  function closeSidebarDrawer() {
    sidebar.classList.remove("open");

    if (!memoryPanel.classList.contains("open")) {
      drawerBackdrop.classList.remove("open");
    }
  }

  function openMemoryDrawer() {
    memoryPanel.classList.add("open");
    drawerBackdrop.classList.add("open");
  }

  function closeMemoryDrawer() {
    memoryPanel.classList.remove("open");

    if (!sidebar.classList.contains("open")) {
      drawerBackdrop.classList.remove("open");
    }
  }

  el("menuToggle").addEventListener(
    "click",
    openSidebarDrawer
  );

  el("memoryToggle").addEventListener(
    "click",
    openMemoryDrawer
  );

  el("memoryClose").addEventListener(
    "click",
    closeMemoryDrawer
  );

  drawerBackdrop.addEventListener(
    "click",
    () => {
      closeSidebarDrawer();
      closeMemoryDrawer();
    }
  );

  // ============================================================
  // MEMORY FILTERS
  // ============================================================

  el("memoryFilters").addEventListener(
    "click",
    (event) => {
      const chip =
        event.target.closest(".filter-chip");

      if (!chip) return;

      state.filter = chip.dataset.filter;

      document
        .querySelectorAll(".filter-chip")
        .forEach((item) => {
          item.classList.toggle(
            "active",
            item === chip
          );
        });

      renderMemoryList();
    }
  );

  // ============================================================
  // MEMORY / METRICS
  // ============================================================

  function badgeCounts() {
    const counts = {
      CONFIRMED: 0,
      INFERRED: 0,
      STALE: 0,
    };

    state.entities.forEach((entity) => {
      if (
        Object.prototype.hasOwnProperty.call(
          counts,
          entity.badge
        )
      ) {
        counts[entity.badge]++;
      }
    });

    return counts;
  }

  function renderMetrics() {
    const counts = badgeCounts();

    el("metricMethods").textContent =
      state.entities.length;

    // The current backend doesn't expose class count.
    el("metricClasses").textContent = "—";

    el("metricConfirmed").textContent =
      counts.CONFIRMED;

    el("metricInferred").textContent =
      counts.INFERRED;

    el("metricStale").textContent =
      counts.STALE;
  }

  function healthBarsMarkup(counts, total) {
    if (!total) {
      return `
        <div class="empty-state">
          No entities tracked yet — ingest a repo to see memory health.
        </div>
      `;
    }

    return [
      "CONFIRMED",
      "INFERRED",
      "STALE",
    ]
      .map((key) => {
        const percentage = Math.round(
          (counts[key] / total) * 100
        );

        return `
          <div class="health-row">
            <span class="health-label">
              ${key}
            </span>

            <div class="health-track">
              <div
                class="health-fill ${key}"
                style="width:${percentage}%"
              ></div>
            </div>

            <span class="health-count">
              ${counts[key]}
            </span>
          </div>
        `;
      })
      .join("");
  }

  function renderHealth() {
    const counts = badgeCounts();
    const total = state.entities.length;

    const markup =
      healthBarsMarkup(
        counts,
        total
      );

    el("healthBars").innerHTML =
      markup;

    el("analysisHealthBars").innerHTML =
      markup;
  }

  function entityCardMarkup(entity) {
    const validated =
      entity.validated_by
        ? `Validated by ${escapeHtml(entity.validated_by)}`
        : "Not yet validated";

    const changed =
      formatDate(
        entity.last_code_changed_at
      );

    return `
      <div
        class="entity-card"
        data-entity="${escapeHtml(entity.entity)}"
      >
        <div class="name">
          ${escapeHtml(entity.entity)}
        </div>

        <span class="badge ${entity.badge}">
          ${entity.badge}
        </span>

        <div class="meta">
          ${validated}
          ${
            changed
              ? " · code seen " + escapeHtml(changed)
              : ""
          }
        </div>
      </div>
    `;
  }

  function renderMemoryList() {
    const filtered =
      state.filter === "ALL"
        ? state.entities
        : state.entities.filter(
            (entity) =>
              entity.badge === state.filter
          );

    if (!filtered.length) {
      el("memoryList").innerHTML = `
        <div class="empty-state">
          ${
            state.entities.length
              ? "No entities match this filter."
              : "No entities tracked yet — ingest the sample repo first."
          }
        </div>
      `;

      return;
    }

    el("memoryList").innerHTML =
      filtered
        .map(entityCardMarkup)
        .join("");
  }

  // ============================================================
  // CODE EXPLORER
  // ============================================================

  function renderExplorerList() {
    if (!state.entities.length) {
      el("explorerEntities").innerHTML = `
        <div class="empty-state">
          No entities tracked yet.
        </div>
      `;

      return;
    }

    el("explorerEntities").innerHTML =
      state.entities
        .map(
          (entity) => `
            <div
              class="entity-row ${
                state.selectedEntity === entity.entity
                  ? "active"
                  : ""
              }"
              data-entity="${escapeHtml(entity.entity)}"
            >
              <span class="entity-row-name">
                ${escapeHtml(entity.entity)}
              </span>

              <span class="badge ${entity.badge}">
                ${entity.badge}
              </span>
            </div>
          `
        )
        .join("");
  }

  function renderExplorerDetail() {
    const detail =
      el("explorerDetail");

    const entity =
      state.entities.find(
        (item) =>
          item.entity ===
          state.selectedEntity
      );

    if (!entity) {
      detail.innerHTML = `
        <div class="empty-state">
          Select an entity on the left to inspect it.
        </div>
      `;

      return;
    }

    const validated =
      entity.validated_by
        ? `Validated by ${escapeHtml(entity.validated_by)}`
        : "Not yet validated";

    const changed =
      formatDate(
        entity.last_code_changed_at
      );

    const confirmedAt =
      formatDate(
        entity.last_validated_at
      );

    detail.innerHTML = `
      <span class="badge-inline ${entity.badge}">
        ${entity.badge}
      </span>

      <div class="detail-title">
        ${escapeHtml(entity.entity)}
      </div>

      <div class="detail-meta">
        ${validated}
        ${
          confirmedAt
            ? " · confirmed " +
              escapeHtml(confirmedAt)
            : ""
        }
        ${
          changed
            ? " · code seen " +
              escapeHtml(changed)
            : ""
        }
      </div>

      <div class="detail-section-label">
        Business Logic
      </div>

      <div
        class="detail-body"
        id="explainBody"
      >
        <button
          class="explain-btn"
          id="explainBtn"
          type="button"
        >
          Ask LegacyLens to explain this
        </button>
      </div>

      <div class="detail-section-label">
        Memory Status
      </div>

      <div class="source-placeholder">
        ${
          entity.badge === "STALE"
            ? "This explanation was previously validated, but the code changed after validation."
            : entity.badge === "CONFIRMED"
              ? "This explanation was human-validated and the code has not changed since validation."
              : "This explanation has been inferred from the code but has not yet been human-validated."
        }
      </div>

      <div class="detail-section-label">
        Source
      </div>

      <div class="source-placeholder">
        Raw source snippets are not currently exposed by the backend.
        The entity can still be explained using the agent's retained
        code knowledge.
      </div>
    `;

    const button =
      el("explainBtn");

    if (button) {
      button.addEventListener(
        "click",
        () =>
          explainEntity(
            entity.entity,
            el("explainBody")
          )
      );
    }
  }

  async function explainEntity(
    entityName,
    target
  ) {
    target.innerHTML = `
      <div
        class="empty-state"
        style="padding:8px 0;text-align:left;"
      >
        Asking LegacyLens…
      </div>
    `;

    try {
      const response =
        await fetch(
          `${API_BASE}/chat`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              message:
                `What does ${entityName} do?`,
              user_name:
                userNameInput.value ||
                "unknown reviewer",
              history: [],
            }),
          }
        );

      let data = {};

      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok) {
        throw new Error(
          friendlyChatError(
            response.status,
            data
          )
        );
      }

      const reply =
        data.reply || data.detail || "";

      if (!reply) {
        throw new Error(
          "No explanation was returned."
        );
      }

      if (isInternalErrorText(reply)) {
        throw new Error(
          "The AI service could not complete this explanation."
        );
      }

      target.innerHTML = "";

      target.appendChild(
        renderMarkdown(reply)
      );

    } catch (error) {
      target.innerHTML = `
        <div
          class="empty-state"
          style="padding:8px 0;text-align:left;"
        >
          ${escapeHtml(error.message)}
        </div>
      `;
    }
  }

  // ============================================================
  // STALE LIST
  // ============================================================

  function renderStaleList() {
    const stale =
      state.entities.filter(
        (entity) =>
          entity.badge === "STALE"
      );

    if (!stale.length) {
      el("staleList").innerHTML = `
        <div class="empty-state">
          Nothing stale right now.
        </div>
      `;

      return;
    }

    el("staleList").innerHTML =
      stale
        .map(entityCardMarkup)
        .join("");
  }

  function renderAll() {
    renderMetrics();
    renderHealth();
    renderMemoryList();
    renderExplorerList();
    renderExplorerDetail();
    renderStaleList();
  }

  // ============================================================
  // ENTITY CLICK HANDLING
  // ============================================================

  document.addEventListener(
    "click",
    (event) => {
      const row =
        event.target.closest(
          ".entity-row, .entity-card"
        );

      if (!row) return;

      const entity =
        row.dataset.entity;

      if (!entity) return;

      state.selectedEntity =
        entity;

      setActiveView(
        "explorer"
      );

      renderExplorerList();
      renderExplorerDetail();
    }
  );

  // ============================================================
  // MEMORY REFRESH
  // ============================================================

  async function refreshMemories() {
    try {
      const response =
        await fetch(
          `${API_BASE}/memories`,
          {
            cache: "no-store",
          }
        );

      if (!response.ok) {
        throw new Error(
          `Memory API returned ${response.status}`
        );
      }

      const data =
        await response.json();

      state.entities =
        Array.isArray(data.entities)
          ? data.entities
          : [];

      renderAll();

    } catch (error) {
      console.error(
        "Memory refresh failed:",
        error
      );

      if (!state.entities.length) {
        el("memoryList").innerHTML = `
          <div class="empty-state">
            Could not load codebase memory.
          </div>
        `;
      }
    }
  }

  // ============================================================
  // HEALTH CHECK
  // ============================================================

  async function checkHealth() {
    try {
      const response =
        await fetch(
          `${API_BASE}/health`,
          {
            cache: "no-store",
          }
        );

      if (!response.ok) {
        throw new Error(
          "Backend unavailable"
        );
      }

      state.backendOnline = true;

      statusDot.className =
        "status-dot ok";

      statusText.textContent =
        "Backend Connected";

      settingsStatus.textContent =
        "Connected";

    } catch (error) {
      state.backendOnline = false;

      statusDot.className =
        "status-dot bad";

      statusText.textContent =
        "Backend Unreachable";

      settingsStatus.textContent =
        "Unreachable";
    }
  }

  // ============================================================
  // CHAT
  // ============================================================

  function addMessage(
    role,
    text
  ) {
    emptyChat.style.display =
      "none";

    const wrapper =
      document.createElement(
        "div"
      );

    wrapper.className =
      `msg ${role}`;

    if (role === "assistant") {
      wrapper.appendChild(
        renderMarkdown(text)
      );

    } else {
      wrapper.textContent =
        text;
    }

    messagesEl.appendChild(
      wrapper
    );

    messagesEl.scrollTop =
      messagesEl.scrollHeight;
  }

  function trimHistory() {
    if (
      state.history.length <=
      MAX_HISTORY_MESSAGES
    ) {
      return;
    }

    state.history =
      state.history.slice(
        -MAX_HISTORY_MESSAGES
      );
  }

  async function sendMessage(text) {
    const message =
      (
        text !== undefined
          ? text
          : chatInput.value
      ).trim();

    if (!message) return;

    chatInput.value = "";

    sendBtn.disabled = true;

    typingIndicator.hidden =
      false;

    addMessage(
      "user",
      message
    );

    // IMPORTANT:
    // Send only previous history here.
    // The backend appends the current message itself.
    const previousHistory =
      state.history.slice(
        -MAX_HISTORY_MESSAGES
      );

    try {
      const response =
        await fetch(
          `${API_BASE}/chat`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              message,
              user_name:
                userNameInput.value ||
                "unknown reviewer",
              history:
                previousHistory,
            }),
          }
        );

      let data = {};

      try {
        data =
          await response.json();
      } catch {
        data = {};
      }

      if (!response.ok) {
        throw new Error(
          friendlyChatError(
            response.status,
            data
          )
        );
      }

      const reply =
        data.reply ||
        data.detail ||
        "";

      if (!reply) {
        throw new Error(
          "The backend returned an empty response."
        );
      }

      if (isInternalErrorText(reply)) {
        throw new Error(
          "The AI service could not complete this request. Please try again."
        );
      }

      addMessage(
        "assistant",
        reply
      );

      // Save conversation AFTER successful response.
      state.history.push({
        role: "user",
        content: message,
      });

      state.history.push({
        role: "assistant",
        content: reply,
      });

      trimHistory();

    } catch (error) {
      console.error(
        "Chat request failed:",
        error
      );

      addMessage(
        "error",
        error.message ||
          "Unable to contact backend."
      );

    } finally {
      sendBtn.disabled =
        false;

      typingIndicator.hidden =
        true;

      chatInput.focus();

      refreshMemories();
    }
  }

  chatForm.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      sendMessage();
    }
  );

  // ============================================================
  // SUGGESTED QUESTIONS
  // ============================================================

  el("suggestedQuestions")
    .addEventListener(
      "click",
      (event) => {
        const button =
          event.target.closest(
            ".suggestion"
          );

        if (!button) return;

        sendMessage(
          button.textContent
        );
      }
    );

  // ============================================================
  // SETTINGS
  // ============================================================

  settingsApiBase.textContent =
    API_BASE || "(same origin)";

  settingsName.value =
    userNameInput.value;

  settingsName.addEventListener(
    "input",
    () => {
      userNameInput.value =
        settingsName.value;
    }
  );

  userNameInput.addEventListener(
    "input",
    () => {
      settingsName.value =
        userNameInput.value;
    }
  );

  // ============================================================
  // KEYBOARD SHORTCUTS
  // ============================================================

  chatInput.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey
      ) {
        event.preventDefault();

        if (!sendBtn.disabled) {
          chatForm.requestSubmit();
        }
      }
    }
  );

  // ============================================================
  // INIT
  // ============================================================

  refreshMemories();

  checkHealth();

  setInterval(
    refreshMemories,
    8000
  );

  setInterval(
    checkHealth,
    15000
  );
})();
