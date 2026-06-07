const state = {
  user: null,
  groups: [],
  selectedGroupId: null,
  contacts: [],
  pollTimer: null,
};

const $ = (selector) => document.querySelector(selector);

function show(view) {
  $("#login-view").classList.toggle("hidden", view !== "login");
  $("#app-view").classList.toggle("hidden", view !== "app");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function truncate(value, length = 120) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

async function boot() {
  const session = await api("/api/me");
  if (session.user) {
    state.user = session.user;
    show("app");
    await refreshAll();
    startPolling();
  } else {
    show("login");
  }
}

async function login(event) {
  event.preventDefault();
  $("#login-error").classList.add("hidden");
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: $("#email").value,
        password: $("#password").value,
      }),
    });
    state.user = data.user;
    show("app");
    await refreshAll();
    startPolling();
  } catch (error) {
    $("#login-error").textContent = "Email atau password tidak valid.";
    $("#login-error").classList.remove("hidden");
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  state.user = null;
  state.selectedGroupId = null;
  stopPolling();
  show("login");
}

async function refreshAll() {
  await Promise.all([loadGroups(), loadStats()]);
  if (state.selectedGroupId) {
    await Promise.all([loadContacts(state.selectedGroupId), loadMessages()]);
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    refreshAll().catch(() => {});
  }, 5000);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function loadGroups() {
  const query = encodeURIComponent($("#group-search").value.trim());
  const data = await api(`/api/groups?q=${query}`);
  state.groups = data.groups;
  renderGroups();
  if (!state.selectedGroupId && state.groups.length) {
    await selectGroup(state.groups[0].id);
  }
}

function renderGroups() {
  const container = $("#group-list");
  if (!state.groups.length) {
    container.innerHTML = `<div class="empty-state">Belum ada pesan teks grup yang masuk.</div>`;
    return;
  }
  container.innerHTML = state.groups
    .map(
      (group) => `
        <button class="group-item ${Number(state.selectedGroupId) === Number(group.id) ? "active" : ""}"
          data-group-id="${group.id}">
          <span class="group-row">
            <span class="group-name">${escapeHtml(group.name)}</span>
            <span class="group-time">${escapeHtml(formatTime(group.last_message_at))}</span>
          </span>
          <span class="last-message">${escapeHtml(truncate(group.last_message || "Belum ada pesan", 150))}</span>
          <span class="group-time">${Number(group.messages_today || 0)} pesan hari ini</span>
        </button>
      `
    )
    .join("");
  container.querySelectorAll(".group-item").forEach((button) => {
    button.addEventListener("click", () => selectGroup(button.dataset.groupId));
  });
}

async function selectGroup(groupId) {
  state.selectedGroupId = groupId;
  const group = state.groups.find((item) => Number(item.id) === Number(groupId));
  $("#selected-group-name").textContent = group ? group.name : "Percakapan";
  $("#selected-group-meta").textContent = group
    ? `${group.participant_count || "-"} anggota | ${group.wa_chat_id}`
    : "Belum ada grup dipilih";
  renderGroups();
  await Promise.all([loadContacts(groupId), loadMessages()]);
}

async function loadContacts(groupId) {
  const data = await api(`/api/contacts?group_id=${encodeURIComponent(groupId)}`);
  state.contacts = data.contacts;
  const current = $("#sender-filter").value;
  $("#sender-filter").innerHTML = `
    <option value="">Semua pengirim</option>
    ${state.contacts
      .map(
        (contact) =>
          `<option value="${contact.id}">${escapeHtml(contact.display_name)} (${escapeHtml(contact.wa_contact_id)})</option>`
      )
      .join("")}
  `;
  $("#sender-filter").value = current;
}

function dateToIsoStart(value) {
  return value ? `${value}T00:00:00+00:00` : "";
}

function dateToIsoEnd(value) {
  return value ? `${value}T23:59:59+00:00` : "";
}

async function loadMessages() {
  if (!state.selectedGroupId) return;
  const params = new URLSearchParams();
  params.set("limit", "120");
  if ($("#message-keyword").value.trim()) params.set("q", $("#message-keyword").value.trim());
  if ($("#sender-filter").value) params.set("sender_id", $("#sender-filter").value);
  if ($("#from-filter").value) params.set("from", dateToIsoStart($("#from-filter").value));
  if ($("#to-filter").value) params.set("to", dateToIsoEnd($("#to-filter").value));
  const data = await api(`/api/groups/${state.selectedGroupId}/messages?${params.toString()}`);
  renderMessages(data.messages);
}

function renderMessages(messages) {
  const container = $("#message-list");
  container.classList.toggle("empty-state", !messages.length);
  if (!messages.length) {
    container.innerHTML = "Tidak ada pesan teks untuk filter ini.";
    return;
  }
  container.innerHTML = messages
    .map(
      (message) => `
        <article class="message" data-message-id="${message.id}">
          <div class="message-meta">
            <span class="sender-name">${escapeHtml(message.sender_name)}</span>
            <span class="message-time">${escapeHtml(formatTime(message.wa_timestamp))}</span>
          </div>
          <div class="message-body">${escapeHtml(message.body)}</div>
        </article>
      `
    )
    .join("");
  container.scrollTop = container.scrollHeight;
}

async function runGlobalSearch() {
  const keyword = $("#global-search").value.trim();
  if (!keyword) {
    $("#search-results").innerHTML = "";
    return;
  }
  const data = await api(`/api/search?q=${encodeURIComponent(keyword)}`);
  renderSearchResults(data.results);
}

function renderSearchResults(results) {
  const container = $("#search-results");
  if (!results.length) {
    container.innerHTML = `<div class="result-context">Tidak ada hasil.</div>`;
    return;
  }
  container.innerHTML = results
    .map(
      (result) => `
        <div class="search-result" data-group-id="${result.group_id}">
          <div class="result-context">
            ${escapeHtml(result.group_name)} | ${escapeHtml(result.sender_name)} | ${escapeHtml(formatTime(result.wa_timestamp))}
          </div>
          <div class="result-body">${escapeHtml(truncate(result.body, 180))}</div>
        </div>
      `
    )
    .join("");
  container.querySelectorAll(".search-result").forEach((item) => {
    item.addEventListener("click", async () => {
      await selectGroup(item.dataset.groupId);
    });
  });
}

async function loadStats() {
  const data = await api("/api/admin/stats");
  const totals = data.totals || {};
  $("#stats").innerHTML = [
    ["groups", "Grup"],
    ["messages", "Pesan"],
    ["stored", "Stored"],
    ["ignored", "Ignored"],
    ["duplicate", "Duplikat"],
    ["failed", "Gagal"],
  ]
    .map(
      ([key, label]) => `
        <div class="stat">
          <span class="stat-value">${Number(totals[key] || 0)}</span>
          <span class="stat-label">${label}</span>
        </div>
      `
    )
    .join("");
  $("#recent-events").innerHTML = (data.recent_events || [])
    .map(
      (event) => `
        <div class="event-item">
          <span class="status-pill ${escapeHtml(event.status)}">${escapeHtml(event.status)}</span>
          <div class="event-reason">${escapeHtml(event.reason || "ok")} | ${escapeHtml(formatTime(event.received_at))}</div>
        </div>
      `
    )
    .join("");
}

$("#login-form").addEventListener("submit", login);
$("#logout-button").addEventListener("click", logout);
$("#refresh-button").addEventListener("click", () => refreshAll());
$("#group-search").addEventListener("input", () => loadGroups().catch(() => {}));
$("#apply-filter").addEventListener("click", () => loadMessages());
$("#reset-filter").addEventListener("click", () => {
  $("#message-keyword").value = "";
  $("#sender-filter").value = "";
  $("#from-filter").value = "";
  $("#to-filter").value = "";
  loadMessages();
});
$("#global-search-button").addEventListener("click", runGlobalSearch);
$("#global-search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") runGlobalSearch();
});

boot().catch(() => show("login"));
