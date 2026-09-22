const AUTH_TOKEN_KEY = "ge_admin_token";

const state = {
  tab: "home",
  dashboard: null,
  members: [],
  groups: [],
  reminders: [],
  settings: null,
  wa: null,
  composeType: "text",
  mobileMenuOpen: false,
};

const $ = (selector, root = document) => root.querySelector(selector);

const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

/* -------------------------------------------------------
   Authentication token
------------------------------------------------------- */

function getAuthToken() {
  try {
    return sessionStorage.getItem(AUTH_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function setAuthToken(token) {
  if (!token) {
    return;
  }

  try {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    throw new Error("Could not store the authentication session.");
  }
}

function clearAuthToken() {
  try {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

const icons = {
  home: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5"></path>
      <path d="M5.5 9.5V21h13V9.5"></path>
      <path d="M9.5 21v-6h5v6"></path>
    </svg>
  `,

  users: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"></path>
      <circle cx="9.5" cy="7" r="4"></circle>
      <path d="M17 3.2a4 4 0 0 1 0 7.6"></path>
      <path d="M21 21v-2a4 4 0 0 0-3-3.86"></path>
    </svg>
  `,

  send: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="m22 2-7 20-4-9-9-4Z"></path>
      <path d="M22 2 11 13"></path>
    </svg>
  `,

  clock: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9"></circle>
      <path d="M12 7v5l3 2"></path>
    </svg>
  `,

  whatsapp: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M20.4 11.2a8.4 8.4 0 0 1-12.3 7.4L3 20l1.4-4.9a8.4 8.4 0 1 1 16-3.9Z"></path>
      <path d="M8.6 8.1c.2-.4.4-.4.7-.4h.5c.2 0 .4.1.5.4l.8 1.8c.1.3.1.5-.1.7l-.6.7c-.1.1-.1.3 0 .5.4.7 1 1.3 1.7 1.7.2.1.4.1.5 0l.7-.7c.2-.2.4-.2.7-.1l1.8.9c.3.1.4.3.4.5v.6c0 .3 0 .5-.4.7-.5.3-1.4.4-2.5.1-1-.3-2.2-1-3.4-2.2-1.1-1.1-1.8-2.3-2.1-3.2-.4-1.1-.2-2 .1-2.5Z"></path>
    </svg>
  `,

  settings: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2"></circle>
      <path d="m19.4 15 .1.1a1.9 1.9 0 0 1-2.7 2.7l-.1-.1a1.9 1.9 0 0 0-3.2 1.3v.2a1.9 1.9 0 0 1-3.8 0V19a1.9 1.9 0 0 0-3.2-1.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1A1.9 1.9 0 0 0 2.5 12H2.3a1.9 1.9 0 0 1 0-3.8h.2a1.9 1.9 0 0 0 1.3-3.2l-.1-.1"></path>
    </svg>
  `,

  logout: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M10 17l5-5-5-5"></path>
      <path d="M15 12H3"></path>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"></path>
    </svg>
  `,

  refresh: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10"></path>
      <path d="M3 5v5h5"></path>
      <path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14"></path>
      <path d="M21 19v-5h-5"></path>
    </svg>
  `,

  check: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="m5 12 4 4L19 6"></path>
    </svg>
  `,

  arrow: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M5 12h14"></path>
      <path d="m13 6 6 6-6 6"></path>
    </svg>
  `,

  search: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8"></circle>
      <path d="m16 16 5 5"></path>
    </svg>
  `,

  copy: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="2"></rect>
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>
    </svg>
  `,

  calendar: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2"></rect>
      <path d="M16 2v4M8 2v4M3 9h18"></path>
    </svg>
  `,

  menu: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16"></path>
    </svg>
  `,

  broadcast: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M6 8a8 8 0 0 0 0 8"></path>
      <path d="M18 8a8 8 0 0 1 0 8"></path>
      <path d="M9 10.5a3 3 0 0 0 0 3"></path>
      <path d="M15 10.5a3 3 0 0 1 0 3"></path>
      <circle cx="12" cy="12" r="1.6"></circle>
    </svg>
  `,
};

function icon(name, className = "") {
  return `
    <span class="icon ${className}">
      ${icons[name] || ""}
    </span>
  `;
}

/* -------------------------------------------------------
   Mobile navigation
------------------------------------------------------- */

function syncMobileMenu() {
  const button = $("#mobileMenuButton");

  const sidebar = $("#sidebar");

  const backdrop = $("#sidebarBackdrop");

  if (!button || !sidebar || !backdrop) {
    return;
  }

  button.setAttribute("aria-expanded", state.mobileMenuOpen ? "true" : "false");

  button.setAttribute(
    "aria-label",
    state.mobileMenuOpen ? "Close navigation" : "Open navigation",
  );

  sidebar.classList.toggle("open", state.mobileMenuOpen);

  backdrop.hidden = !state.mobileMenuOpen;

  document.body.classList.toggle("mobile-nav-open", state.mobileMenuOpen);
}

function openMobileMenu() {
  state.mobileMenuOpen = true;

  syncMobileMenu();
}

function closeMobileMenu() {
  state.mobileMenuOpen = false;

  syncMobileMenu();
}

function toggleMobileMenu() {
  state.mobileMenuOpen ? closeMobileMenu() : openMobileMenu();
}

/* -------------------------------------------------------
   Feedback
------------------------------------------------------- */

function toast(message, type = "success") {
  const host = $("#toastHost");

  if (!host) {
    return;
  }

  const item = document.createElement("div");

  item.className = `toast ${type}`;

  item.innerHTML = `
    <div class="toast-icon">
      ${icon(type === "error" ? "menu" : "check")}
    </div>

    <div class="toast-copy">
      <strong>
        ${esc(type === "error" ? "Unable to complete" : "Done")}
      </strong>

      <span>
        ${esc(message)}
      </span>
    </div>

    <button
      class="toast-close"
      type="button"
      aria-label="Dismiss"
    >
      ${icon("menu")}
    </button>
  `;

  host.appendChild(item);

  let removed = false;

  const remove = () => {
    if (removed) {
      return;
    }

    removed = true;

    item.classList.add("is-leaving");

    setTimeout(() => item.remove(), 180);
  };

  $(".toast-close", item).onclick = remove;

  setTimeout(remove, 5200);
}

function busy(button, on, label = "Working…") {
  if (!button) {
    return;
  }

  if (on) {
    button.dataset.restore = button.innerHTML;

    button.disabled = true;

    button.classList.add("is-busy");

    button.innerHTML = `<span class="spinner"></span>${esc(label)}`;
  } else {
    button.disabled = false;

    button.classList.remove("is-busy");

    button.innerHTML = button.dataset.restore || button.innerHTML;

    delete button.dataset.restore;
  }
}

/* -------------------------------------------------------
   API
------------------------------------------------------- */

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});

  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  headers.set("Accept", "application/json");

  const token = getAuthToken();

  /*
   * Authentication is now sent explicitly
   * using the Authorization header.
   */
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), 20000);

  let res;

  try {
    res = await fetch(url, {
      ...options,
      headers,

      /*
       * Cookies are no longer used
       * for dashboard authentication.
       */
      credentials: "omit",

      signal: controller.signal,

      cache: "no-store",
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The request timed out. Please try again.");
    }

    throw new Error("The server could not be reached.");
  } finally {
    clearTimeout(timer);
  }

  const contentType = res.headers.get("content-type") || "";

  const data = contentType.includes("json")
    ? await res.json().catch(() => ({}))
    : await res
        .text()
        .then((text) => ({
          message: text,
        }))
        .catch(() => ({}));

  if (res.status === 401) {
    clearAuthToken();

    showLogin();

    throw new Error("Please sign in again.");
  }

  if (!res.ok) {
    throw new Error(
      data.error || data.message || `Request failed (${res.status})`,
    );
  }

  return data;
}

/* -------------------------------------------------------
   Visibility / navigation
------------------------------------------------------- */

function showLogin() {
  clearAuthToken();

  $("#loginView").hidden = false;

  $("#appView").hidden = true;

  closeMobileMenu();

  setTimeout(() => $("#email")?.focus(), 50);
}

function showApp() {
  $("#loginView").hidden = true;

  $("#appView").hidden = false;

  refresh();
}

function switchTab(tab) {
  state.tab = tab;

  $$(".nav-item").forEach((button) => {
    const active = button.dataset.tab === tab;

    button.classList.toggle("active", active);

    button.setAttribute("aria-current", active ? "page" : "false");
  });

  $$(".tab-panel").forEach((panel) => {
    panel.hidden = panel.id !== tab;
  });

  closeMobileMenu();

  render();
}

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

/* -------------------------------------------------------
   Data
------------------------------------------------------- */

async function refresh() {
  try {
    const [dashboard, members, reminders, groups, settings, wa] =
      await Promise.all([
        api("/api/dashboard"),

        api("/api/members?status=active"),

        api("/api/reminders"),

        api("/api/whatsapp/groups").catch(() => ({
          groups: [],
        })),

        api("/api/settings"),

        api("/api/whatsapp/status"),
      ]);

    state.dashboard = dashboard;

    state.members = members.members || [];

    state.reminders = reminders.reminders || [];

    state.groups = groups.groups || [];

    state.settings = settings.settings || {};

    state.wa = wa;

    $("#brandName").textContent =
      state.settings.churchName || "Grace Encounter";

    $("#eventNameSide").textContent = state.settings.eventName || "Gathering";

    $("#eventLocationSide").textContent =
      state.settings.eventLocation || "Location not configured";

    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

function render() {
  renderStatus();
  renderHome();
  renderMembers();
  renderCompose();
  renderReminders();
  renderWhatsApp();
  renderSettings();
}

/* -------------------------------------------------------
   Status
------------------------------------------------------- */

function renderStatus() {
  const status = String(state.wa?.status || "disconnected");

  const chip = $("#waStatus");

  if (!chip) {
    return;
  }

  const connected = status === "connected";

  chip.className = `status-chip ${connected ? "online" : "offline"}`;

  chip.innerHTML = `
    <span class="status-dot"></span>
    <span>WhatsApp</span>
    <strong>
      ${esc(status)}
    </strong>
  `;

  const stateText = $("#connectionStateText");

  if (stateText) {
    stateText.textContent = connected
      ? "Connected and ready to send"
      : "WhatsApp is not connected";
  }
}

/* -------------------------------------------------------
   Home
------------------------------------------------------- */

function renderHome() {
  const stats = state.dashboard?.stats || {};

  const total = Number(stats.total || 0);

  const linked = Number(stats.linked || 0);

  const valid = Number(stats.valid || 0);

  const remindersEnabled = Number(stats.remindersEnabled || 0);

  const validPercent = total > 0 ? Math.round((valid / total) * 100) : 0;

  const linkPercent = total > 0 ? Math.round((linked / total) * 100) : 0;

  $("#home").innerHTML = `
    <div class="page-head page-head-hero">
      <div>
        <div class="eyebrow">
          ${icon("home")}
          Administration centre
        </div>

        <h2>
          Good morning, ${esc(state.settings?.churchName || "Grace Encounter")}.
        </h2>

        <p class="subtle page-description">
          Keep your members organised, your WhatsApp connection healthy,
          and every communication ready to go.
        </p>
      </div>

      <div class="head-actions">
        <button
          class="button button-secondary"
          id="homeRefreshBtn"
          type="button"
        >
          ${icon("refresh")}
          Refresh
        </button>

        <button
          class="button button-primary"
          id="notifyAllBtn"
          type="button"
        >
          ${icon("broadcast")}
          Confirm all members
        </button>
      </div>
    </div>

    <section class="hero-strip">
      <div class="hero-strip-copy">
        <div class="hero-strip-label">
          ${icon("calendar")}
          Upcoming gathering
        </div>

        <h3>
          ${esc(state.settings?.eventName || "Gathering not configured")}
        </h3>

        <p>
          ${esc(
            state.settings?.eventLocation ||
              "Set the gathering location in Settings.",
          )}
        </p>
      </div>

      <div class="hero-strip-meta">
        <span class="soft-badge">
          Keyword
          <strong>
            ${esc(state.settings?.keyword || "gracehelp")}
          </strong>
        </span>

        <span class="soft-badge">
          WhatsApp
          <strong
            class="${
              state.wa?.status === "connected"
                ? "positive-text"
                : "negative-text"
            }"
          >
            ${esc(state.wa?.status || "disconnected")}
          </strong>
        </span>
      </div>
    </section>

    <div class="section-heading">
      <div>
        <span class="section-label">
          At a glance
        </span>

        <h3>
          Member health
        </h3>
      </div>

      <button
        class="text-action"
        id="homeMembersLink"
        type="button"
      >
        Open members
        ${icon("arrow")}
      </button>
    </div>

    <div class="stats-grid">
      <article class="metric metric-highlight">
        <div class="metric-top">
          <span>Active members</span>

          <span class="metric-icon">
            ${icon("users")}
          </span>
        </div>

        <strong>
          ${esc(total)}
        </strong>

        <div class="metric-foot">
          <small>
            Current member records
          </small>
        </div>
      </article>

      <article class="metric">
        <div class="metric-top">
          <span>WhatsApp linked</span>

          <span class="metric-icon">
            ${icon("whatsapp")}
          </span>
        </div>

        <strong>
          ${esc(linked)}
        </strong>

        <div class="metric-foot metric-progress">
          <div class="progress">
            <span
              style="width:${linkPercent}%"
            ></span>
          </div>

          <small>
            ${linkPercent}% linked
          </small>
        </div>
      </article>

      <article class="metric">
        <div class="metric-top">
          <span>Valid records</span>

          <span class="metric-icon">
            ${icon("check")}
          </span>
        </div>

        <strong>
          ${esc(valid)}
        </strong>

        <div class="metric-foot metric-progress">
          <div class="progress">
            <span
              style="width:${validPercent}%"
            ></span>
          </div>

          <small>
            ${validPercent}% valid
          </small>
        </div>
      </article>

      <article class="metric">
        <div class="metric-top">
          <span>Active reminders</span>

          <span class="metric-icon">
            ${icon("clock")}
          </span>
        </div>

        <strong>
          ${esc(remindersEnabled)}
        </strong>

        <div class="metric-foot">
          <small>
            Members receiving reminders
          </small>
        </div>
      </article>
    </div>

    <div class="section-heading section-heading-spaced">
      <div>
        <span class="section-label">
          Workspace
        </span>

        <h3>
          Quick actions
        </h3>
      </div>
    </div>

    <div class="quick-grid">
      <button
        class="quick-card"
        data-go-tab="members"
        type="button"
      >
        <span class="quick-icon">
          ${icon("users")}
        </span>

        <span class="quick-copy">
          <strong>
            Manage members
          </strong>

          <small>
            Search, inspect and confirm member records.
          </small>
        </span>

        ${icon("arrow", "quick-arrow")}
      </button>

      <button
        class="quick-card"
        data-go-tab="compose"
        type="button"
      >
        <span class="quick-icon">
          ${icon("send")}
        </span>

        <span class="quick-copy">
          <strong>
            Send communication
          </strong>

          <small>
            Messages, posts, events, menus and carousels.
          </small>
        </span>

        ${icon("arrow", "quick-arrow")}
      </button>

      <button
        class="quick-card"
        data-go-tab="reminders"
        type="button"
      >
        <span class="quick-icon">
          ${icon("clock")}
        </span>

        <span class="quick-copy">
          <strong>
            Schedule a reminder
          </strong>

          <small>
            Create one-time or recurring member messages.
          </small>
        </span>

        ${icon("arrow", "quick-arrow")}
      </button>

      <button
        class="quick-card"
        data-go-tab="whatsapp"
        type="button"
      >
        <span class="quick-icon">
          ${icon("whatsapp")}
        </span>

        <span class="quick-copy">
          <strong>
            WhatsApp connection
          </strong>

          <small>
            Pair the account, load QR and inspect groups.
          </small>
        </span>

        ${icon("arrow", "quick-arrow")}
      </button>
    </div>

    <div class="bottom-grid">
      <article class="panel info-panel">
        <div class="panel-heading">
          <div>
            <span class="section-label">
              Gathering
            </span>

            <h3>
              ${esc(state.settings?.eventName || "Gathering")}
            </h3>
          </div>

          <span class="panel-heading-icon">
            ${icon("calendar")}
          </span>
        </div>

        <div class="info-list">
          <div>
            <span>
              Location
            </span>

            <strong>
              ${esc(state.settings?.eventLocation || "Not configured")}
            </strong>
          </div>

          <div>
            <span>
              Transport
            </span>

            <strong>
              ${esc(
                state.settings?.transportNotice ||
                  "No transport notice configured",
              )}
            </strong>
          </div>
        </div>
      </article>

      <article class="panel info-panel">
        <div class="panel-heading">
          <div>
            <span class="section-label">
              Member experience
            </span>

            <h3>
              WhatsApp keyword
            </h3>
          </div>

          <span class="panel-heading-icon">
            ${icon("whatsapp")}
          </span>
        </div>

        <div class="keyword-box">
          <span class="keyword-pill">
            ${esc(state.settings?.keyword || "gracehelp")}
          </span>

          <p>
            Members can send this keyword in a private chat or approved
            group to open the WhatsApp menu.
          </p>
        </div>
      </article>
    </div>
  `;

  $("#notifyAllBtn").onclick = () =>
    openConfirm(
      "Confirm all members",
      "Send each active member a private confirmation containing their name, WhatsApp number and reference code?",
      async () => {
        await sendMemberNotifications("all");
      },
    );

  $("#homeRefreshBtn").onclick = async (event) => {
    const button = event.currentTarget;

    try {
      busy(button, true, "Refreshing…");

      await refresh();

      toast("Dashboard refreshed.");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      busy(button, false);
    }
  };

  $("#homeMembersLink").onclick = () => {
    switchTab("members");

    scrollToTop();
  };

  $$("[data-go-tab]").forEach((button) => {
    button.onclick = () => {
      switchTab(button.dataset.goTab);

      scrollToTop();
    };
  });
}

/* -------------------------------------------------------
   Members
------------------------------------------------------- */

function renderMembers() {
  const rows = state.members
    .map((member) => {
      const valid = Boolean(member.validation?.isValid);

      const initials = String(member.fullName || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();

      return `
            <tr>
              <td class="select-cell">
                <input
                  class="member-select"
                  type="checkbox"
                  value="${esc(member.id)}"
                  ${member.phone ? "" : "disabled"}
                  aria-label="Select ${esc(member.fullName)}"
                >
              </td>

              <td>
                <span class="member-code">
                  ${esc(member.code)}
                </span>
              </td>

              <td>
                <div class="person-cell">
                  <div class="avatar">
                    ${esc(initials)}
                  </div>

                  <div>
                    <strong>
                      ${esc(member.fullName)}
                    </strong>

                    <small>
                      ${
                        member.phone
                          ? "WhatsApp number available"
                          : "No WhatsApp number"
                      }
                    </small>
                  </div>
                </div>
              </td>

              <td>
                <span class="phone-value">
                  ${esc(member.phone ? `+${member.phone}` : "—")}
                </span>
              </td>

              <td>
                <span
                  class="tag ${valid ? "good" : "warn"}"
                >
                  <span class="tag-dot"></span>
                  ${valid ? "Valid" : "Needs attention"}
                </span>
              </td>

              <td>
                <span
                  class="reminder-state ${
                    member.remindersEnabled ? "enabled" : "disabled"
                  }"
                >
                  <span class="status-dot"></span>
                  ${member.remindersEnabled ? "On" : "Off"}
                </span>
              </td>
            </tr>
          `;
    })
    .join("");

  $("#members").innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">
          ${icon("users")}
          Directory
        </div>

        <h2>
          Members
        </h2>

        <p class="subtle page-description">
          Search the active member list and choose people for a private confirmation.
        </p>
      </div>

      <div class="head-actions">
        <button
          class="button button-secondary"
          id="membersRefresh"
          type="button"
        >
          ${icon("refresh")}
          Refresh
        </button>

        <button
          class="button button-primary"
          id="notifySelected"
          type="button"
        >
          ${icon("broadcast")}
          Confirm selected
        </button>
      </div>
    </div>

    <div class="directory-toolbar">
      <div class="search-box">
        ${icon("search")}

        <input
          id="memberSearch"
          type="search"
          placeholder="Search name, code or phone"
          autocomplete="off"
          enterkeyhint="search"
        >
      </div>

      <div class="selection-summary">
        <span id="memberSelectionCount">
          0 selected
        </span>

        <span class="toolbar-divider"></span>

        <span>
          ${state.members.length}
          active members
        </span>
      </div>
    </div>

    <div class="table-card directory-card">
      <table>
        <thead>
          <tr>
            <th class="select-cell">
              <input
                id="selectAllMembers"
                type="checkbox"
                aria-label="Select all visible members"
              >
            </th>

            <th>Reference</th>
            <th>Member</th>
            <th>WhatsApp</th>
            <th>Record</th>
            <th>Reminders</th>
          </tr>
        </thead>

        <tbody>
          ${
            rows ||
            `
              <tr>
                <td colspan="6">
                  <div class="empty-state">
                    <div class="empty-icon">
                      ${icon("users")}
                    </div>

                    <strong>
                      No members found
                    </strong>

                    <p>
                      There are no active member records to display.
                    </p>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  `;

  const search = $("#memberSearch");

  const selectionCount = $("#memberSelectionCount");

  const selectAll = $("#selectAllMembers");

  const updateSelection = () => {
    const selected = $$(".member-select:checked").length;

    const available = $$(".member-select:not(:disabled)").length;

    selectionCount.textContent = `${selected} selected`;

    selectAll.checked = available > 0 && selected === available;

    selectAll.indeterminate = selected > 0 && selected < available;
  };

  search.oninput = (event) => {
    const query = event.target.value.toLowerCase().trim();

    $$("#members tbody tr").forEach((row) => {
      row.hidden =
        Boolean(query) && !row.textContent.toLowerCase().includes(query);
    });
  };

  $$(".member-select").forEach((checkbox) => {
    checkbox.onchange = updateSelection;
  });

  selectAll.onchange = (event) => {
    $$(".member-select:not(:disabled)").forEach((checkbox) => {
      checkbox.checked = event.target.checked;
    });

    updateSelection();
  };

  $("#membersRefresh").onclick = refresh;

  $("#notifySelected").onclick = () => {
    const memberIds = $$(".member-select:checked").map((input) => input.value);

    if (!memberIds.length) {
      toast("Select at least one member first.", "error");

      return;
    }

    openConfirm(
      "Confirm selected members",
      `Send private confirmations to ${memberIds.length} selected member(s)?`,
      async () => {
        const response = await api("/api/outreach/confirm-members", {
          method: "POST",

          body: JSON.stringify({
            mode: "selected",

            memberIds,
          }),
        });

        toast(`Successful: ${response.sent}. Failed: ${response.failed}.`);

        await refresh();
      },
    );
  };
}

/* -------------------------------------------------------
   Audience
------------------------------------------------------- */

function memberOptions() {
  return state.members
    .filter((member) => member.phone)
    .map(
      (member) => `
        <option
          data-kind="member"
          value="${esc(member.id)}"
        >
          ${esc(member.code)}
          —
          ${esc(member.fullName)}
        </option>
      `,
    )
    .join("");
}

function groupOptions() {
  return state.groups
    .map(
      (group) => `
        <option
          data-kind="group"
          value="${esc(group.id)}"
        >
          ${esc(group.subject)}
          —
          ${esc(group.id)}
        </option>
      `,
    )
    .join("");
}

function targetBlock(prefix) {
  return `
    <div class="field">
      <label for="${prefix}-targetType">
        Audience
      </label>

      <div class="audience-select-wrap">
        <select
          id="${prefix}-targetType"
          data-audience-type="${prefix}"
        >
          <option value="all_members">
            All active members
          </option>

          <option value="members">
            Selected members
          </option>

          <option value="group">
            One group
          </option>

          <option value="groups">
            Selected groups
          </option>

          <option value="all_groups">
            All groups
          </option>
        </select>
      </div>

      <div
        id="${prefix}-audienceDescription"
        class="field-hint"
      >
        This will be sent privately to every active member.
      </div>
    </div>

    <div class="field">
      <label for="${prefix}-targetIds">
        Targets
      </label>

      <div class="select-shell">
        <select
          id="${prefix}-targetIds"
          multiple
          size="6"
          data-audience-targets="${prefix}"
        >
          ${memberOptions()}
          ${groupOptions()}
        </select>
      </div>

      <small id="${prefix}-targetHelp">
        No manual selection is needed for this audience.
      </small>
    </div>
  `;
}

function updateAudienceUI(prefix) {
  const targetType = $(`#${prefix}-targetType`);

  const targetIds = $(`#${prefix}-targetIds`);

  const targetHelp = $(`#${prefix}-targetHelp`);

  const description = $(`#${prefix}-audienceDescription`);

  if (!targetType || !targetIds || !targetHelp || !description) {
    return;
  }

  const selected = targetType.value;

  const descriptions = {
    all_members: "This will be sent privately to every active member.",

    members: "Choose the members who should receive this message.",

    group: "Choose one WhatsApp group as the destination.",

    groups: "Choose the WhatsApp groups that should receive this message.",

    all_groups: "This will be sent to every available WhatsApp group.",
  };

  description.textContent = descriptions[selected] || descriptions.all_members;

  const needsSelection = ["members", "group", "groups"].includes(selected);

  targetIds.disabled = !needsSelection;

  const kind =
    selected === "members"
      ? "member"
      : ["group", "groups"].includes(selected)
        ? "group"
        : null;

  $$("option", targetIds).forEach((option) => {
    const hidden = Boolean(kind) && option.dataset.kind !== kind;

    option.hidden = hidden;

    if (hidden) {
      option.selected = false;
    }
  });

  if (!needsSelection) {
    targetIds.selectedIndex = -1;

    targetHelp.textContent = "No manual selection is needed for this audience.";
  } else if (selected === "group") {
    targetHelp.textContent = "Choose one group.";
  } else {
    targetHelp.textContent =
      "On desktop use Ctrl/Cmd for multiple selections. On mobile, tap and scroll through the list.";
  }
}

function getAudienceValues(prefix) {
  return {
    targetType: $(`#${prefix}-targetType`)?.value || "all_members",

    targetIds: [...($(`#${prefix}-targetIds`)?.selectedOptions || [])].map(
      (option) => option.value,
    ),
  };
}

/* -------------------------------------------------------
   Compose
------------------------------------------------------- */

function renderCompose() {
  const types = [
    ["text", "Text", "send"],
    ["post", "Post", "broadcast"],
    ["event", "Event", "calendar"],
    ["menu", "Menu", "menu"],
    ["carousel", "Carousel", "users"],
  ];

  const titles = {
    text: "Text message",

    post: "Image post",

    event: "WhatsApp event",

    menu: "Interactive menu",

    carousel: "Carousel",
  };

  $("#compose").innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">
          ${icon("send")}
          Communication
        </div>

        <h2>
          Compose
        </h2>

        <p class="subtle page-description">
          Create and send polished WhatsApp communications using the same backend renderer.
        </p>
      </div>
    </div>

    <div class="compose-switcher">
      ${types
        .map(
          ([type, label, iconName]) => `
            <button
              class="compose-type ${state.composeType === type ? "active" : ""}"
              data-type="${type}"
              type="button"
              aria-pressed="${state.composeType === type}"
            >
              ${icon(iconName)}
              <span>
                ${label}
              </span>
            </button>
          `,
        )
        .join("")}
    </div>

    <div class="card compose-card-main">
      <div class="compose-topline">
        <div>
          <span class="section-label">
            Create message
          </span>

          <h3>
            ${esc(titles[state.composeType])}
          </h3>
        </div>

        <span class="compose-live">
          <span class="status-dot"></span>
          Ready to send
        </span>
      </div>

      <form id="composeForm"></form>
    </div>
  `;

  $$(".compose-type").forEach((button) => {
    button.onclick = () => {
      state.composeType = button.dataset.type;

      renderCompose();
      scrollToTop();
    };
  });

  buildComposeForm();
}

function buildComposeForm() {
  const form = $("#composeForm");

  let fields = "";

  if (state.composeType === "text") {
    fields = `
      <div class="grid-2">
        ${targetBlock("compose")}
      </div>

      <div class="field">
        <label for="text">
          Message
        </label>

        <textarea
          id="text"
          required
          maxlength="4096"
          placeholder="Write your message..."
        ></textarea>

        <div class="field-meta">
          <small>
            Keep your message clear and easy to read.
          </small>

          <small id="textCount">
            0 / 4096
          </small>
        </div>
      </div>
    `;
  }

  if (state.composeType === "post") {
    fields = `
      <div class="grid-2">
        ${targetBlock("compose")}
      </div>

      <div class="field">
        <label for="image">
          Image URL
        </label>

        <input
          id="image"
          type="url"
          required
          placeholder="https://example.com/image.jpg"
        >

        <small>
          Use a publicly reachable image URL.
        </small>
      </div>

      <div class="field">
        <label for="caption">
          Caption
        </label>

        <textarea
          id="caption"
          required
          placeholder="Write the caption..."
        ></textarea>
      </div>
    `;
  }

  if (state.composeType === "event") {
    fields = `
      <div class="grid-2">
        ${targetBlock("compose")}
      </div>

      <div class="grid-2">
        <div class="field">
          <label for="eventName">
            Event name
          </label>

          <input
            id="eventName"
            required
            placeholder="Sunday Gathering"
          >
        </div>

        <div class="field">
          <label for="locationName">
            Location name
          </label>

          <input
            id="locationName"
            placeholder="Uhuru Park"
          >
        </div>

        <div class="field">
          <label for="startDate">
            Start
          </label>

          <input
            id="startDate"
            type="datetime-local"
            required
          >
        </div>

        <div class="field">
          <label for="endDate">
            End
          </label>

          <input
            id="endDate"
            type="datetime-local"
            required
          >
        </div>
      </div>

      <div class="field">
        <label for="description">
          Description
        </label>

        <textarea
          id="description"
          placeholder="Add useful details about the event..."
        ></textarea>
      </div>
    `;
  }

  if (state.composeType === "menu") {
    fields = `
      <div class="grid-2">
        ${targetBlock("compose")}
      </div>

      <div class="field">
        <label for="text">
          Message
        </label>

        <input
          id="text"
          value="Please choose an option below."
        >
      </div>

      <div class="section-divider">
        <div>
          <span class="section-label">
            Interactive choices
          </span>

          <h4>
            Menu options
          </h4>
        </div>

        <small>
          Up to four quick replies.
        </small>
      </div>

      <div class="grid-2">
        ${[
          "Open member menu|member:view",
          "Open transport|event:transport",
          "Open event|event:details",
          "Open help|help",
        ]
          .map(
            (value, index) => `
              <div class="choice-card">
                <span class="choice-number">
                  0${index + 1}
                </span>

                <label
                  for="opt${index + 1}"
                  class="choice-label"
                >
                  Option ${index + 1}

                  <input
                    id="opt${index + 1}"
                    value="${esc(value)}"
                  >
                </label>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  if (state.composeType === "carousel") {
    fields = `
      <div class="grid-2">
        ${targetBlock("compose")}
      </div>

      <div class="field">
        <label for="text">
          Intro
        </label>

        <input
          id="text"
          value="Please browse the cards below."
        >
      </div>

      <div class="section-divider">
        <div>
          <span class="section-label">
            Content
          </span>

          <h4>
            Carousel cards
          </h4>
        </div>

        <small>
          Empty cards are ignored.
        </small>
      </div>

      <div class="carousel-stack">
        ${[1, 2, 3, 4]
          .map(
            (i) => `
              <div class="carousel-card">
                <div class="carousel-card-heading">
                  <div class="carousel-card-index">
                    0${i}
                  </div>

                  <div>
                    <strong>
                      Card ${i}
                    </strong>

                    <small>
                      Optional content
                    </small>
                  </div>
                </div>

                <div class="grid-2">
                  <div class="field">
                    <label for="c${i}title">
                      Title
                    </label>

                    <input
                      id="c${i}title"
                    >
                  </div>

                  <div class="field">
                    <label for="c${i}image">
                      Image URL
                    </label>

                    <input
                      id="c${i}image"
                      type="url"
                    >
                  </div>
                </div>

                <div class="field">
                  <label for="c${i}body">
                    Body
                  </label>

                  <textarea
                    id="c${i}body"
                  ></textarea>
                </div>

                <div class="grid-2">
                  <div class="field">
                    <label for="c${i}button">
                      Button text
                    </label>

                    <input
                      id="c${i}button"
                      value="Open"
                    >
                  </div>

                  <div class="field">
                    <label for="c${i}id">
                      Button ID
                    </label>

                    <input
                      id="c${i}id"
                      value="card_${i}"
                    >
                  </div>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  form.innerHTML = `
    <div class="compose-form-fields">
      ${fields}
    </div>

    <div class="form-actions compose-submit-row">
      <div class="compose-help">
        ${icon("whatsapp")}

        <span>
          Your message will be delivered through the connected WhatsApp account.
        </span>
      </div>

      <div class="compose-send-area">
        <span
          id="composeResult"
          class="subtle"
        ></span>

        <button
          class="button button-primary button-send"
          type="submit"
        >
          ${icon("send")}
          Send now
        </button>
      </div>
    </div>
  `;

  const targetType = $("#compose-targetType");

  if (targetType) {
    targetType.onchange = () => updateAudienceUI("compose");

    updateAudienceUI("compose");
  }

  const text = $("#text");

  const textCount = $("#textCount");

  if (text && textCount) {
    const updateCount = () => {
      textCount.textContent = `${text.value.length} / 4096`;
    };

    text.addEventListener("input", updateCount);

    updateCount();
  }

  form.onsubmit = sendCompose;
}

function payloadFromCompose() {
  const type = state.composeType;

  if (type === "text") {
    return {
      kind: "text",

      text: $("#text").value.trim(),
    };
  }

  if (type === "post") {
    return {
      kind: "post",

      image: {
        url: $("#image").value.trim(),
      },

      caption: $("#caption").value.trim(),
    };
  }

  if (type === "event") {
    return {
      kind: "event",

      name: $("#eventName").value.trim(),

      location: {
        name: $("#locationName").value.trim(),
      },

      startDate: $("#startDate").value,

      endDate: $("#endDate").value,

      description: $("#description").value.trim(),

      extraGuestsAllowed: true,
    };
  }

  if (type === "menu") {
    const buttons = [];

    for (let i = 1; i <= 4; i++) {
      const raw = $(`#opt${i}`)?.value || "";

      const separator = raw.indexOf("|");

      const text = separator >= 0 ? raw.slice(0, separator) : raw;

      const id = separator >= 0 ? raw.slice(separator + 1) : "";

      if (text.trim() && id.trim()) {
        buttons.push({
          name: "quick_reply",

          buttonParamsJson: JSON.stringify({
            display_text: text.trim(),

            id: id.trim(),
          }),
        });
      }
    }

    return {
      kind: "interactive",

      text: $("#text").value.trim(),

      footer: state.settings?.botFooter || "",

      buttons,
    };
  }

  const cards = [];

  for (let i = 1; i <= 4; i++) {
    const title = $(`#c${i}title`).value.trim();

    const body = $(`#c${i}body`).value.trim();

    const image = $(`#c${i}image`).value.trim();

    if (!title && !body && !image) {
      continue;
    }

    const cardId = $(`#c${i}id`).value.trim() || `card_${i}`;

    cards.push({
      id: cardId,

      title,

      body,

      image,

      buttons: [
        {
          name: "quick_reply",

          buttonParamsJson: JSON.stringify({
            display_text: $(`#c${i}button`).value.trim() || "Open",

            id: cardId,
          }),
        },
      ],
    });
  }

  return {
    kind: "carousel",

    text: $("#text").value.trim(),

    footer: state.settings?.botFooter || "",

    cards,
  };
}

async function sendCompose(event) {
  event.preventDefault();

  const button = event.currentTarget.querySelector('button[type="submit"]');

  const { targetType, targetIds } = getAudienceValues("compose");

  const result = $("#composeResult");

  try {
    busy(button, true, "Sending…");

    result.textContent = "Sending your communication…";

    const response = await api("/api/messages/send", {
      method: "POST",

      body: JSON.stringify({
        targetType,
        targetIds,
        payload: payloadFromCompose(),
      }),
    });

    const successful = (response.results || []).filter(
      (item) => item.ok,
    ).length;

    const failed = (response.results || []).filter((item) => !item.ok).length;

    result.textContent = `Sent: ${successful}. Failed: ${failed}.`;

    toast(`Completed with ${successful} successful delivery attempts.`);
  } catch (err) {
    result.textContent = err.message;

    toast(err.message, "error");
  } finally {
    busy(button, false);
  }
}

/* -------------------------------------------------------
   Reminders
------------------------------------------------------- */

function renderReminders() {
  const schedulerEnabled = state.dashboard?.schedulerEnabled !== false;

  $("#reminders").innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">
          ${icon("clock")}
          Automation
        </div>

        <h2>
          Reminders
        </h2>

        <p class="subtle page-description">
          Schedule messages once or create recurring reminders for your members.
        </p>
      </div>

      <div
        class="system-pill ${
          schedulerEnabled ? "system-good" : "system-warning"
        }"
      >
        <span class="status-dot"></span>
        ${schedulerEnabled ? "Scheduler available" : "Scheduler disabled"}
      </div>
    </div>

    <div class="card reminder-create-card">
      <div class="compose-topline">
        <div>
          <span class="section-label">
            Create reminder
          </span>

          <h3>
            Schedule a message
          </h3>
        </div>

        <span class="small-badge">
          ${icon("clock")}
          Automated delivery
        </span>
      </div>

      <form
        id="reminderForm"
        class="reminder-form"
      >
        <div class="grid-2">
          <div class="field">
            <label for="rTitle">
              Title
            </label>

            <input
              id="rTitle"
              required
              placeholder="Sunday reminder"
            >
          </div>

          <div class="field">
            <label for="rType">
              Type
            </label>

            <select id="rType">
              <option value="once">
                One time
              </option>

              <option value="cron">
                Recurring
              </option>
            </select>
          </div>

          <div
            class="field"
            id="runAtField"
          >
            <label for="rRunAt">
              Run at
            </label>

            <input
              id="rRunAt"
              type="datetime-local"
            >
          </div>

          <div
            class="field"
            id="cronField"
          >
            <label for="rCron">
              Cron expression
            </label>

            <input
              id="rCron"
              placeholder="0 9 * * 1"
            >

            <small>
              Example: every Monday at 09:00.
            </small>
          </div>
        </div>

        <div class="section-divider">
          <div>
            <span class="section-label">
              Audience
            </span>

            <h4>
              Who should receive it?
            </h4>
          </div>
        </div>

        <div class="grid-2">
          ${targetBlock("reminder")}
        </div>

        <div class="field full">
          <label for="rText">
            Message
          </label>

          <textarea
            id="rText"
            required
            placeholder="Write the reminder message..."
          ></textarea>
        </div>

        <div class="form-actions">
          <span
            id="rResult"
            class="subtle"
          ></span>

          <button
            class="button button-primary"
            type="submit"
          >
            ${icon("clock")}
            Save reminder
          </button>
        </div>
      </form>
    </div>

    <div class="section-heading section-heading-spaced">
      <div>
        <span class="section-label">
          Scheduled
        </span>

        <h3>
          Active reminders
        </h3>
      </div>

      <span class="small-badge">
        ${state.reminders.length}
        total
      </span>
    </div>

    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th>Reminder</th>
            <th>Type</th>
            <th>Audience</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>

        <tbody>
          ${
            state.reminders
              .map(
                (reminder) => `
                  <tr>
                    <td>
                      <strong>
                        ${esc(reminder.title)}
                      </strong>
                    </td>

                    <td>
                      <span class="table-type">
                        ${esc(reminder.scheduleType)}
                      </span>
                    </td>

                    <td>
                      <span class="table-type">
                        ${esc(reminder.targetType)}
                      </span>
                    </td>

                    <td>
                      <span
                        class="reminder-state ${
                          reminder.active ? "enabled" : "disabled"
                        }"
                      >
                        <span class="status-dot"></span>
                        ${reminder.active ? "Active" : "Stopped"}
                      </span>
                    </td>

                    <td class="table-action-cell">
                      <button
                        class="button button-quiet button-small stop-reminder"
                        data-id="${esc(reminder.id)}"
                        type="button"
                      >
                        Stop
                      </button>
                    </td>
                  </tr>
                `,
              )
              .join("") ||
            `
              <tr>
                <td colspan="5">
                  <div class="empty-state">
                    <div class="empty-icon">
                      ${icon("clock")}
                    </div>

                    <strong>
                      No reminders
                    </strong>

                    <p>
                      Create a reminder above to automate a message.
                    </p>
                  </div>
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  `;

  const targetType = $("#reminder-targetType");

  if (targetType) {
    targetType.onchange = () => updateAudienceUI("reminder");

    updateAudienceUI("reminder");
  }

  const type = $("#rType");

  const runAtField = $("#runAtField");

  const cronField = $("#cronField");

  const updateScheduleFields = () => {
    const recurring = type.value === "cron";

    runAtField.classList.toggle("field-hidden", recurring);

    cronField.classList.toggle("field-hidden", !recurring);

    $("#rRunAt").required = !recurring;

    $("#rCron").required = recurring;
  };

  type.onchange = updateScheduleFields;

  updateScheduleFields();

  $("#reminderForm").onsubmit = async (event) => {
    event.preventDefault();

    const button = event.currentTarget.querySelector("button");

    const result = $("#rResult");

    try {
      busy(button, true, "Saving…");

      result.textContent = "Saving reminder…";

      const { targetType, targetIds } = getAudienceValues("reminder");

      await api("/api/reminders", {
        method: "POST",

        body: JSON.stringify({
          title: $("#rTitle").value,

          scheduleType: $("#rType").value,

          runAt: $("#rRunAt").value
            ? new Date($("#rRunAt").value).toISOString()
            : null,

          cronExpression: $("#rCron").value.trim() || null,

          targetType,

          targetIds,

          payload: {
            kind: "text",

            text: $("#rText").value.trim(),
          },
        }),
      });

      toast("Reminder saved.");

      await refresh();
    } catch (err) {
      result.textContent = err.message;

      toast(err.message, "error");
    } finally {
      busy(button, false);
    }
  };

  $$(".stop-reminder").forEach((button) => {
    button.onclick = () =>
      openConfirm(
        "Stop reminder",
        "Stop this scheduled reminder?",
        async () => {
          await api(`/api/reminders/${encodeURIComponent(button.dataset.id)}`, {
            method: "DELETE",
          });

          toast("Reminder stopped.");

          await refresh();
        },
      );
  });
}

/* -------------------------------------------------------
   WhatsApp
------------------------------------------------------- */

function renderWhatsApp() {
  $("#whatsapp").innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">
          ${icon("whatsapp")}
          WhatsApp
        </div>

        <h2>
          Connection & groups
        </h2>

        <p class="subtle page-description">
          Connect the account and manage the same WhatsApp renderer used for
          direct messages, groups, menus, events and carousels.
        </p>
      </div>
    </div>

    <div class="connection-hero ${
      state.wa?.status === "connected"
        ? "connection-online"
        : "connection-offline"
    }">
      <div class="connection-icon">
        ${icon("whatsapp")}
      </div>

      <div class="connection-copy">
        <span class="section-label">
          Connection status
        </span>

        <h3>
          ${esc(
            state.wa?.status === "connected"
              ? "WhatsApp is connected"
              : "WhatsApp needs attention",
          )}
        </h3>

        <p>
          ${
            state.wa?.status === "connected"
              ? "The account is ready to deliver messages."
              : "Pair the account using a pairing code or QR code."
          }
        </p>
      </div>

      <div class="connection-status-large">
        <span class="status-dot"></span>

        ${esc(state.wa?.status || "disconnected")}
      </div>
    </div>

    <div class="card-grid whatsapp-tools">
      <article class="panel">
        <div class="panel-heading">
          <div>
            <span class="section-label">
              Pairing
            </span>

            <h3>
              Phone pairing code
            </h3>
          </div>

          <span class="panel-heading-icon">
            ${icon("whatsapp")}
          </span>
        </div>

        <p class="panel-description">
          Enter the WhatsApp number in international format to request
          a pairing code.
        </p>

        <div class="field">
          <label for="pairPhone">
            WhatsApp number
          </label>

          <input
            id="pairPhone"
            placeholder="2547XXXXXXXX"
            inputmode="numeric"
            autocomplete="tel"
          >
        </div>

        <div class="pair-code-area">
          <div class="pair-code-box">
            <span class="pair-code-label">
              PAIRING CODE
            </span>

            <strong id="pairCode">
              —
            </strong>
          </div>

          <button
            class="icon-button"
            id="copyPairCode"
            type="button"
            aria-label="Copy pairing code"
            title="Copy pairing code"
          >
            ${icon("copy")}
          </button>
        </div>

        <div class="form-actions">
          <button
            class="button button-primary"
            id="pairBtn"
            type="button"
          >
            ${icon("whatsapp")}
            Request code
          </button>
        </div>
      </article>

      <article class="panel">
        <div class="panel-heading">
          <div>
            <span class="section-label">
              QR connection
            </span>

            <h3>
              Scan QR code
            </h3>
          </div>

          <span class="panel-heading-icon">
            ${icon("refresh")}
          </span>
        </div>

        <p class="panel-description">
          Load the current WhatsApp QR code and scan it from your phone.
        </p>

        <button
          class="button button-secondary"
          id="qrBtn"
          type="button"
        >
          ${icon("refresh")}
          Load QR
        </button>

        <div
          id="qrArea"
          class="qr-area"
        >
          <div class="qr-placeholder">
            <div class="qr-placeholder-icon">
              ${icon("whatsapp")}
            </div>

            <strong>
              No QR loaded
            </strong>

            <span>
              Press “Load QR” when the WhatsApp session is ready.
            </span>
          </div>
        </div>
      </article>
    </div>

    <section class="panel groups-panel">
      <div class="panel-heading groups-heading">
        <div>
          <span class="section-label">
            WhatsApp groups
          </span>

          <h3>
            Available groups
          </h3>

          <p class="subtle">
            ${state.groups.length}
            groups available to this WhatsApp account.
          </p>
        </div>

        <button
          class="button button-secondary"
          id="groupRefresh"
          type="button"
        >
          ${icon("refresh")}
          Refresh groups
        </button>
      </div>

      <div class="directory-toolbar group-toolbar">
        <div class="search-box">
          ${icon("search")}

          <input
            id="groupSearch"
            type="search"
            placeholder="Search groups..."
            autocomplete="off"
            enterkeyhint="search"
          >
        </div>
      </div>

      <div
        class="group-list"
        id="groupList"
      >
        ${
          state.groups.length
            ? state.groups
                .map(
                  (group) => `
                    <div
                      class="group-row"
                      data-group-search="${esc(
                        `${group.subject} ${group.id}`,
                      ).toLowerCase()}"
                    >
                      <div class="group-main">
                        <div class="group-avatar">
                          ${esc(
                            String(group.subject || "?")
                              .trim()
                              .charAt(0)
                              .toUpperCase(),
                          )}
                        </div>

                        <div>
                          <strong>
                            ${esc(group.subject)}
                          </strong>

                          <small>
                            ${esc(group.id)}
                          </small>
                        </div>
                      </div>

                      <span class="group-size">
                        ${esc(group.size)}
                        members
                      </span>
                    </div>
                  `,
                )
                .join("")
            : `
              <div class="empty-state">
                <div class="empty-icon">
                  ${icon("whatsapp")}
                </div>

                <strong>
                  No groups available
                </strong>

                <p>
                  Connect WhatsApp and refresh the group list.
                </p>
              </div>
            `
        }
      </div>
    </section>
  `;

  $("#pairBtn").onclick = requestPairing;

  $("#qrBtn").onclick = loadQr;

  $("#groupRefresh").onclick = async () => {
    const button = $("#groupRefresh");

    try {
      busy(button, true, "Refreshing…");

      const response = await api("/api/whatsapp/groups");

      state.groups = response.groups || [];

      toast(`${state.groups.length} groups loaded.`);

      renderWhatsApp();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      busy(button, false);
    }
  };

  $("#copyPairCode").onclick = async () => {
    const code = $("#pairCode").textContent.trim();

    if (!code || code === "—") {
      toast("There is no pairing code to copy.", "error");

      return;
    }

    try {
      await navigator.clipboard.writeText(code);

      toast("Pairing code copied.");
    } catch {
      toast("Could not copy the pairing code.", "error");
    }
  };

  $("#groupSearch").oninput = (event) => {
    const query = event.target.value.toLowerCase().trim();

    $$(".group-row").forEach((row) => {
      row.hidden = Boolean(query) && !row.dataset.groupSearch.includes(query);
    });
  };
}

async function requestPairing(event) {
  const button = event.currentTarget;

  try {
    busy(button, true, "Requesting…");

    const response = await api("/api/whatsapp/pairing-code", {
      method: "POST",

      body: JSON.stringify({
        phone: $("#pairPhone").value,
      }),
    });

    $("#pairCode").textContent = response.code || "—";

    toast("Pairing code requested.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    busy(button, false);
  }
}

async function loadQr(event) {
  const button = event.currentTarget;

  try {
    busy(button, true, "Loading…");

    const response = await api("/api/whatsapp/qr");

    if (!response.dataUrl) {
      throw new Error("No QR code is available yet.");
    }

    $("#qrArea").innerHTML = `
      <img
        class="qr"
        src="${esc(response.dataUrl)}"
        alt="WhatsApp QR code"
      >

      <span class="qr-caption">
        Scan this code from WhatsApp on your phone.
      </span>
    `;
  } catch (error) {
    toast(error.message, "error");
  } finally {
    busy(button, false);
  }
}

/* -------------------------------------------------------
   Settings
------------------------------------------------------- */

function renderSettings() {
  const settings = state.settings || {};

  $("#settings").innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">
          ${icon("settings")}
          Configuration
        </div>

        <h2>
          Settings
        </h2>

        <p class="subtle page-description">
          Manage the operational wording and gathering details without
          touching the source code.
        </p>
      </div>
    </div>

    <div class="settings-layout">
      <aside class="settings-intro panel">
        <div class="settings-icon">
          ${icon("settings")}
        </div>

        <span class="section-label">
          Workspace configuration
        </span>

        <h3>
          Keep the experience consistent.
        </h3>

        <p>
          These values are used throughout the administration interface
          and member-facing communication.
        </p>

        <div class="settings-note">
          <span class="status-dot"></span>
          Changes are saved directly to the application settings.
        </div>
      </aside>

      <div class="card">
        <form
          id="settingsForm"
          class="settings-form"
        >
          <div class="section-divider">
            <div>
              <span class="section-label">
                Identity
              </span>

              <h4>
                Organisation details
              </h4>
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="sChurch">
                Church name
              </label>

              <input
                id="sChurch"
                value="${esc(settings.churchName || "")}"
                placeholder="Grace Encounter"
              >
            </div>

            <div class="field">
              <label for="sKeyword">
                Member keyword
              </label>

              <input
                id="sKeyword"
                value="${esc(settings.keyword || "gracehelp")}"
                placeholder="gracehelp"
              >
            </div>
          </div>

          <div class="section-divider">
            <div>
              <span class="section-label">
                Gathering
              </span>

              <h4>
                Event information
              </h4>
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="sEvent">
                Event name
              </label>

              <input
                id="sEvent"
                value="${esc(settings.eventName || "")}"
                placeholder="Uhuru Park Gathering"
              >
            </div>

            <div class="field">
              <label for="sLocation">
                Event location
              </label>

              <input
                id="sLocation"
                value="${esc(settings.eventLocation || "")}"
                placeholder="Uhuru Park, Nairobi"
              >
            </div>
          </div>

          <div class="field">
            <label for="sTransport">
              Transport notice
            </label>

            <textarea
              id="sTransport"
              placeholder="Add transport information for members..."
            >${esc(settings.transportNotice || "")}</textarea>
          </div>

          <div class="section-divider">
            <div>
              <span class="section-label">
                WhatsApp experience
              </span>

              <h4>
                Bot presentation
              </h4>
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="sFooter">
                Bot footer
              </label>

              <input
                id="sFooter"
                value="${esc(settings.botFooter || "")}"
                placeholder="Grace Encounter"
              >
            </div>

            <div class="field">
              <label for="sMenuIntro">
                Menu introduction
              </label>

              <input
                id="sMenuIntro"
                value="${esc(settings.menuIntro || "")}"
                placeholder="Choose an option below"
              >
            </div>
          </div>

          <div class="settings-actions">
            <span class="subtle">
              Keep member-facing wording short and clear.
            </span>

            <button
              class="button button-primary"
              type="submit"
            >
              ${icon("check")}
              Save settings
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  $("#settingsForm").onsubmit = async (event) => {
    event.preventDefault();

    const button = event.currentTarget.querySelector("button");

    try {
      busy(button, true, "Saving…");

      await api("/api/settings", {
        method: "PATCH",

        body: JSON.stringify({
          keyword: $("#sKeyword").value.trim().toLowerCase(),

          churchName: $("#sChurch").value.trim(),

          eventName: $("#sEvent").value.trim(),

          eventLocation: $("#sLocation").value.trim(),

          transportNotice: $("#sTransport").value.trim(),

          botFooter: $("#sFooter").value.trim(),

          menuIntro: $("#sMenuIntro").value.trim(),
        }),
      });

      toast("Settings updated.");

      await refresh();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      busy(button, false);
    }
  };
}

/* -------------------------------------------------------
   Member notifications
------------------------------------------------------- */

async function sendMemberNotifications(mode) {
  try {
    const response = await api("/api/outreach/confirm-members", {
      method: "POST",

      body: JSON.stringify({
        mode,
      }),
    });

    toast(`Successful: ${response.sent}. Failed: ${response.failed}.`);
  } catch (error) {
    toast(error.message, "error");
  }
}

/* -------------------------------------------------------
   Modal
------------------------------------------------------- */

function openConfirm(title, message, onYes) {
  const host = $("#modalHost");

  host.hidden = false;

  host.innerHTML = `
    <div class="modal-backdrop">
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modalTitle"
      >
        <div class="modal-icon">
          ${icon("check")}
        </div>

        <div class="modal-copy">
          <h3 id="modalTitle">
            ${esc(title)}
          </h3>

          <p>
            ${esc(message)}
          </p>
        </div>

        <div class="modal-actions">
          <button
            class="button button-quiet"
            id="modalNo"
            type="button"
          >
            Cancel
          </button>

          <button
            class="button button-primary"
            id="modalYes"
            type="button"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  `;

  $("#modalNo").onclick = () => {
    host.hidden = true;
  };

  $(".modal-backdrop", host).onclick = (event) => {
    if (event.target === event.currentTarget) {
      host.hidden = true;
    }
  };

  $("#modalYes").onclick = async (event) => {
    const button = event.currentTarget;

    try {
      busy(button, true, "Working…");

      await onYes();

      host.hidden = true;
    } catch (error) {
      toast(error.message, "error");
    } finally {
      busy(button, false);
    }
  };
}

/* -------------------------------------------------------
   Login / logout
------------------------------------------------------- */

$("#loginForm").onsubmit = async (event) => {
  event.preventDefault();

  const button = event.currentTarget.querySelector("button");

  $("#loginError").textContent = "";

  try {
    busy(button, true, "Signing in…");

    const response = await api("/api/auth/login", {
      method: "POST",

      body: JSON.stringify({
        email: $("#email").value,

        password: $("#password").value,
      }),
    });

    if (!response?.token) {
      throw new Error("The server did not return an authentication token.");
    }

    setAuthToken(response.token);

    /*
     * Only show the application after the
     * token has successfully been stored.
     */
    showApp();
  } catch (error) {
    clearAuthToken();

    $("#loginError").textContent = error.message;
  } finally {
    busy(button, false);
  }
};

$("#logoutBtn").onclick = async (event) => {
  const button = event.currentTarget;

  try {
    busy(button, true, "Signing out…");

    /*
     * Tell the server that the client is
     * ending the session, then remove the
     * locally stored JWT.
     */
    await api("/api/auth/logout", {
      method: "POST",
    });

    clearAuthToken();

    showLogin();
  } catch (error) {
    /*
     * Even if the logout request fails,
     * remove the local token so the browser
     * cannot continue using the old session.
     */
    clearAuthToken();

    showLogin();

    toast(error.message, "error");
  } finally {
    busy(button, false);
  }
};

/* -------------------------------------------------------
   Navigation
------------------------------------------------------- */

$$(".nav-item").forEach((button) => {
  button.onclick = () => {
    switchTab(button.dataset.tab);

    scrollToTop();
  };
});

$("#mobileMenuButton").onclick = toggleMobileMenu;

$("#sidebarBackdrop").onclick = closeMobileMenu;

/* -------------------------------------------------------
   Keyboard
------------------------------------------------------- */

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const modal = $("#modalHost");

    if (modal && !modal.hidden) {
      modal.hidden = true;

      return;
    }

    if (state.mobileMenuOpen) {
      closeMobileMenu();

      return;
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    const search =
      state.tab === "members"
        ? $("#memberSearch")
        : state.tab === "whatsapp"
          ? $("#groupSearch")
          : null;

    if (search) {
      event.preventDefault();

      search.focus();
    }
  }
});

/* -------------------------------------------------------
   Resize safety
------------------------------------------------------- */

window.addEventListener("resize", () => {
  if (window.innerWidth > 850 && state.mobileMenuOpen) {
    closeMobileMenu();
  }
});

/* -------------------------------------------------------
   Bootstrap
------------------------------------------------------- */

(async () => {
  syncMobileMenu();

  try {
    /*
     * A valid Bearer JWT is now required.
     */
    await api("/api/auth/me");

    showApp();
  } catch {
    clearAuthToken();

    showLogin();
  }
})();
