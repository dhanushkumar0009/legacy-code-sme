(() => {
  "use strict";

  const API_BASE = window.LEGACY_SME_API_BASE || "";

  // ============================================================
  // DOM ELEMENTS
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
  // APPLICATION STATE
  // ============================================================

  const state = {
    entities: [],
    history: [],
    filter: "ALL",
    activeView: "overview",
    selectedEntity: null,
  };

  // ============================================================
  // MARKDOWN
  // ============================================================

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function renderMarkdown(text) {
    let html;

    try {
      html = window.marked
        ? window.marked.parse(text)
        : escapeHtml(text);
    } catch (e) {
      html = escapeHtml(text);
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;

    wrapper.querySelectorAll("pre code").forEach((block) => {
      if (window.hljs) {
        try {
          window.hljs.highlightElement(block);
        } catch (e) {
          // Ignore highlighting errors
        }
      }

      const pre = block.parentElement;

      if (!pre.querySelector(".copy-btn")) {
        const btn = document.createElement("button");

        btn.className = "copy-btn";
        btn.type = "button";
        btn.textContent = "Copy";

        btn.addEventListener("click", () => {
          navigator.clipboard
            .writeText(block.textContent)
            .then(() => {
              btn.textContent = "Copied";

              setTimeout(() => {
                btn.textContent = "Copy";
              }, 1400);
            });
        });

        pre.appendChild(btn);
      }
    });

    return wrapper;
  }

  // ============================================================
  // NAVIGATION
  // ============================================================

  function setActiveView(view) {
    state.activeView = view;

    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.dataset.view === view
      );
    });

    document.querySelectorAll(".view").forEach((section) => {
      section.classList.toggle(
        "active",
        section.id === "view-" + view
      );
    });

    viewTitle.textContent = VIEW_TITLES[view] || "";

    /*
     * IMPORTANT:
     * Memory is now treated as a normal full-page view.
     *
     * We no longer automatically open the memory drawer
     * when clicking Memory.
     */

    closeSidebarDrawer();

    if (view !== "memoryview") {
      closeMemoryDrawer();
    }
  }

  el("nav").addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-item");

    if (!btn) return;

    setActiveView(btn.dataset.view);
  });

  // ============================================================
  // SIDEBAR
  // ============================================================

  el("sidebarCollapse").addEventListener("click", () => {
    app.classList.toggle("sidebar-collapsed");
  });

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

  drawerBackdrop.addEventListener("click", () => {
    closeSidebarDrawer();
    closeMemoryDrawer();
  });

  // ============================================================
  // MEMORY FILTERS
  // ============================================================

  el("memoryFilters").addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");

    if (!chip) return;

    state.filter = chip.dataset.filter;

    document
      .querySelectorAll(".filter-chip")
      .forEach((c) => {
        c.classList.toggle(
          "active",
          c === chip
        );
      });

    renderMemoryPage();
    renderMemoryList();
  });

  // ============================================================
  // MEMORY COUNTS
  // ============================================================

  function badgeCounts() {
    const counts = {
      CONFIRMED: 0,
      INFERRED: 0,
      STALE: 0,
    };

    state.entities.forEach((entity) => {
      if (counts[entity.badge] !== undefined) {
        counts[entity.badge]++;
      }
    });

    return counts;
  }

  // ============================================================
  // OVERVIEW METRICS
  // ============================================================

  function renderMetrics() {
    const counts = badgeCounts();

    el("metricMethods").textContent =
      state.entities.length;

    el("metricClasses").textContent = "—";

    el("metricConfirmed").textContent =
      counts.CONFIRMED;

    el("metricInferred").textContent =
      counts.INFERRED;

    el("metricStale").textContent =
      counts.STALE;
  }

  // ============================================================
  // HEALTH BARS
  // ============================================================

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
        const pct = total
          ? Math.round(
              (counts[key] / total) * 100
            )
          : 0;

        return `
          <div class="health-row">

            <span class="health-label">
              ${key}
            </span>

            <div class="health-track">
              <div
                class="health-fill ${key}"
                style="width:${pct}%"
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

  // ============================================================
  // DATE FORMATTING
  // ============================================================

  function formatDate(ts) {
    if (!ts) return null;

    try {
      return new Date(
        ts * 1000
      ).toLocaleString();
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // MEMORY CARD
  // ============================================================

  function entityCardMarkup(entity) {
    const validated =
      entity.validated_by
        ? `Validated by ${escapeHtml(
            entity.validated_by
          )}`
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
              ? " · code seen " + changed
              : ""
          }
        </div>

      </div>
    `;
  }

  // ============================================================
  // MEMORY SIDE LIST
  // ============================================================

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
  // NEW FULL MEMORY PAGE
  // ============================================================

  function renderMemoryPage() {
    const container =
      el("memoryPageContent");

    if (!container) {
      return;
    }

    const counts = badgeCounts();

    const filtered =
      state.filter === "ALL"
        ? state.entities
        : state.entities.filter(
            (entity) =>
              entity.badge === state.filter
          );

    container.innerHTML = `
      <div class="memory-dashboard">

        <div class="memory-summary-grid">

          <div class="memory-stat total">
            <div class="memory-stat-label">
              Total Memories
            </div>

            <div class="memory-stat-value">
              ${state.entities.length}
            </div>

            <div class="memory-stat-description">
              Tracked code knowledge
            </div>
          </div>

          <div class="memory-stat confirmed">
            <div class="memory-stat-label">
              Confirmed
            </div>

            <div class="memory-stat-value">
              ${counts.CONFIRMED}
            </div>

            <div class="memory-stat-description">
              Reviewed and validated
            </div>
          </div>

          <div class="memory-stat inferred">
            <div class="memory-stat-label">
              Inferred
            </div>

            <div class="memory-stat-value">
              ${counts.INFERRED}
            </div>

            <div class="memory-stat-description">
              Derived from source code
            </div>
          </div>

          <div class="memory-stat stale">
            <div class="memory-stat-label">
              Stale
            </div>

            <div class="memory-stat-value">
              ${counts.STALE}
            </div>

            <div class="memory-stat-description">
              Needs re-validation
            </div>
          </div>

        </div>

        <div class="memory-dashboard-header">

          <div>
            <h2>Codebase Memory</h2>

            <p>
              Knowledge extracted from your legacy codebase
              and tracked over time.
            </p>
          </div>

          <div class="memory-dashboard-filters">

            ${["ALL", "CONFIRMED", "INFERRED", "STALE"]
              .map(
                (filter) => `
                  <button
                    class="memory-page-filter ${
                      state.filter === filter
                        ? "active"
                        : ""
                    }"
                    data-page-filter="${filter}"
                    type="button"
                  >
                    ${filter}
                  </button>
                `
              )
              .join("")}

          </div>

        </div>

        ${
          filtered.length
            ? `
              <div class="memory-card-grid">

                ${filtered
                  .map(
                    (entity) => `
                      <div
                        class="memory-detail-card"
                        data-memory-entity="${escapeHtml(
                          entity.entity
                        )}"
                      >

                        <div class="memory-card-top">

                          <div class="memory-entity-name">
                            ${escapeHtml(
                              entity.entity
                            )}
                          </div>

                          <span class="badge ${
                            entity.badge
                          }">
                            ${entity.badge}
                          </span>

                        </div>

                        <div class="memory-card-info">

                          <div class="memory-info-row">
                            <span>Status</span>
                            <strong>
                              ${entity.badge}
                            </strong>
                          </div>

                          <div class="memory-info-row">
                            <span>Validated by</span>
                            <strong>
                              ${
                                entity.validated_by
                                  ? escapeHtml(
                                      entity.validated_by
                                    )
                                  : "Not validated"
                              }
                            </strong>
                          </div>

                          <div class="memory-info-row">
                            <span>Last validated</span>
                            <strong>
                              ${
                                formatDate(
                                  entity.last_validated_at
                                ) || "—"
                              }
                            </strong>
                          </div>

                          <div class="memory-info-row">
                            <span>Code changed</span>
                            <strong>
                              ${
                                formatDate(
                                  entity.last_code_changed_at
                                ) || "—"
                              }
                            </strong>
                          </div>

                        </div>

                        <button
                          class="memory-inspect-btn"
                          data-inspect="${escapeHtml(
                            entity.entity
                          )}"
                          type="button"
                        >
                          Inspect Entity →
                        </button>

                      </div>
                    `
                  )
                  .join("")}

              </div>
            `
            : `
              <div class="memory-empty-state">

                <div class="memory-empty-icon">
                  ◇
                </div>

                <h3>
                  No memories found
                </h3>

                <p>
                  ${
                    state.entities.length
                      ? "No memories match the selected filter."
                      : "Ingest your repository to start building codebase memory."
                  }
                </p>

              </div>
            `
        }

      </div>
    `;

    container
      .querySelectorAll(
        ".memory-page-filter"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            state.filter =
              button.dataset.pageFilter;

            renderMemoryPage();

            document
              .querySelectorAll(".filter-chip")
              .forEach((chip) => {
                chip.classList.toggle(
                  "active",
                  chip.dataset.filter ===
                    state.filter
                );
              });
          }
        );
      });

    container
      .querySelectorAll(
        ".memory-inspect-btn"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            const entity =
              button.dataset.inspect;

            state.selectedEntity =
              entity;

            setActiveView(
              "explorer"
            );

            renderExplorerList();
            renderExplorerDetail();
          }
        );
      });
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
                state.selectedEntity ===
                entity.entity
                  ? "active"
                  : ""
              }"
              data-entity="${escapeHtml(
                entity.entity
              )}"
            >

              <span class="entity-row-name">
                ${escapeHtml(
                  entity.entity
                )}
              </span>

              <span class="badge ${
                entity.badge
              }">
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
        (e) =>
          e.entity ===
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
        ? `Validated by ${escapeHtml(
            entity.validated_by
          )}`
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

      <span class="badge-inline ${
        entity.badge
      }">
        ${entity.badge}
      </span>

      <div class="detail-title">
        ${escapeHtml(
          entity.entity
        )}
      </div>

      <div class="detail-meta">
        ${validated}

        ${
          confirmedAt
            ? " · confirmed " +
              confirmedAt
            : ""
        }

        ${
          changed
            ? " · code seen " +
              changed
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
        Source
      </div>

      <div class="source-placeholder">
        Source snippet is not currently exposed
        by the backend.
      </div>
    `;

    const btn =
      el("explainBtn");

    if (btn) {
      btn.addEventListener(
        "click",
        () =>
          explainEntity(
            entity.entity,
            el("explainBody")
          )
      );
    }
  }

  // ============================================================
  // EXPLAIN ENTITY
  // ============================================================

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
      const res =
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

      const data =
        await res.json();

      target.innerHTML = "";

      target.appendChild(
        renderMarkdown(
          data.reply ||
            data.detail ||
            "(no reply)"
        )
      );
    } catch (e) {
      target.innerHTML = `
        <div
          class="empty-state"
          style="
            padding:8px 0;
            text-align:left;
            color:var(--stale);
          "
        >
          Could not reach backend:
          ${escapeHtml(e.message)}
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
          entity.badge ===
          "STALE"
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

  // ============================================================
  // RENDER EVERYTHING
  // ============================================================

  function renderAll() {
    renderMetrics();
    renderHealth();

    renderMemoryList();
    renderMemoryPage();

    renderExplorerList();
    renderExplorerDetail();

    renderStaleList();
  }

  // ============================================================
  // ENTITY CLICK HANDLING
  // ============================================================

  document.addEventListener(
    "click",
    (e) => {
      const row =
        e.target.closest(
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
  // MEMORY API
  // ============================================================

  async function refreshMemories() {
    try {
      const res =
        await fetch(
          `${API_BASE}/memories`,
          {
            cache: "no-store",
          }
        );

      if (!res.ok) {
        throw new Error(
          "Failed to load memories"
        );
      }

      const data =
        await res.json();

      state.entities =
        data.entities || [];

      renderAll();
    } catch (e) {
      el("memoryList").innerHTML = `
        <div class="empty-state">
          Could not reach backend.
        </div>
      `;

      const memoryPage =
        el("memoryPageContent");

      if (memoryPage) {
        memoryPage.innerHTML = `
          <div class="memory-empty-state">
            <h3>
              Backend unavailable
            </h3>

            <p>
              Could not load codebase memory.
            </p>
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
      const res =
        await fetch(
          `${API_BASE}/health`,
          {
            cache: "no-store",
          }
        );

      if (res.ok) {
        statusDot.className =
          "status-dot ok";

        statusText.textContent =
          "Backend Connected";

        settingsStatus.textContent =
          "Connected";
      } else {
        throw new Error(
          "Bad status"
        );
      }
    } catch (e) {
      statusDot.className =
        "status-dot bad";

      statusText.textContent =
        "Backend unreachable";

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

    const wrap =
      document.createElement(
        "div"
      );

    wrap.className =
      "msg " + role;

    if (role === "assistant") {
      const badgeMatch =
        text.match(
          /\b(CONFIRMED|INFERRED|STALE)\b/
        );

      if (badgeMatch) {
        const badge =
          document.createElement(
            "span"
          );

        badge.className =
          "badge-inline " +
          badgeMatch[1];

        badge.textContent =
          badgeMatch[1];

        wrap.appendChild(
          badge
        );

        wrap.appendChild(
          document.createElement(
            "br"
          )
        );
      }

      wrap.appendChild(
        renderMarkdown(text)
      );
    } else {
      wrap.textContent =
        text;
    }

    messagesEl.appendChild(
      wrap
    );

    messagesEl.scrollTop =
      messagesEl.scrollHeight;
  }

  async function sendMessage(
    text
  ) {
    const message =
      (
        text !== undefined
          ? text
          : chatInput.value
      ).trim();

    if (!message) return;

    chatInput.value = "";

    sendBtn.disabled =
      true;

    typingIndicator.hidden =
      false;

    addMessage(
      "user",
      message
    );

    state.history.push({
      role: "user",
      content: message,
    });

    try {
      const res =
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
                state.history,
            }),
          }
        );

      const data =
        await res.json();

      const reply =
        data.reply ||
        data.detail ||
        "(no reply)";

      addMessage(
        "assistant",
        reply
      );

      state.history.push({
        role: "assistant",
        content: reply,
      });
    } catch (e) {
      addMessage(
        "error",
        "Error reaching backend: " +
          e.message
      );
    } finally {
      sendBtn.disabled =
        false;

      typingIndicator.hidden =
        true;

      refreshMemories();
    }
  }

  chatForm.addEventListener(
    "submit",
    (e) => {
      e.preventDefault();

      sendMessage();
    }
  );

  // ============================================================
  // SUGGESTED QUESTIONS
  // ============================================================

  el("suggestedQuestions").addEventListener(
    "click",
    (e) => {
      const btn =
        e.target.closest(
          ".suggestion"
        );

      if (!btn) return;

      sendMessage(
        btn.textContent
      );
    }
  );

  // ============================================================
  // SETTINGS
  // ============================================================

  settingsApiBase.textContent =
    API_BASE ||
    "(same origin)";

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
  // INITIALIZATION
  // ============================================================

  refreshMemories();

  checkHealth();

  // Refresh memory every 8 seconds
  setInterval(
    refreshMemories,
    8000
  );

  // Check backend every 15 seconds
  setInterval(
    checkHealth,
    15000
  );

})();
