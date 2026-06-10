const state = {
  user: null,
  groups: [],
  selectedGroupId: null,
  currentView: "chat",
  contacts: [],
  dailyChanges: [],
  pollTimer: null,
  lastRenderedGroupId: null,
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

function formatShortDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function compactNumber(value) {
  return new Intl.NumberFormat("id-ID", {
    notation: Number(value || 0) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function countBy(rows, keyGetter, labelGetter) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = keyGetter(row);
    if (!key) return;
    const current = counts.get(key) || {
      key,
      label: labelGetter ? labelGetter(row) : key,
      count: 0,
      latestDate: "",
      row,
    };
    current.count += 1;
    if ((row.report_date || "") > current.latestDate) current.latestDate = row.report_date || "";
    counts.set(key, current);
  });
  return Array.from(counts.values()).sort(
    (a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label), "id")
  );
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
  state.currentView = "chat";
  stopPolling();
  show("login");
}

async function refreshAll() {
  await Promise.all([loadGroups(), loadStats()]);
  if (state.selectedGroupId) {
    await Promise.all([loadContacts(state.selectedGroupId), loadMessages({ preserveScroll: true })]);
  }
  if (state.currentView === "dashboard") {
    await loadDailyChanges();
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
  renderDashboardGroupFilter();
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
  await Promise.all([loadContacts(groupId), loadMessages({ preserveScroll: false })]);
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

async function loadMessages({ preserveScroll = true } = {}) {
  if (!state.selectedGroupId) return;
  const params = new URLSearchParams();
  params.set("limit", "120");
  if ($("#message-keyword").value.trim()) params.set("q", $("#message-keyword").value.trim());
  if ($("#sender-filter").value) params.set("sender_id", $("#sender-filter").value);
  if ($("#from-filter").value) params.set("from", dateToIsoStart($("#from-filter").value));
  if ($("#to-filter").value) params.set("to", dateToIsoEnd($("#to-filter").value));
  const data = await api(`/api/groups/${state.selectedGroupId}/messages?${params.toString()}`);
  renderMessages(data.messages, { preserveScroll });
}

function renderMessages(messages, { preserveScroll = true } = {}) {
  const container = $("#message-list");
  const previousScrollTop = container.scrollTop;
  const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  const wasNearBottom = distanceFromBottom < 80;
  const isNewGroup = Number(state.lastRenderedGroupId) !== Number(state.selectedGroupId);

  container.classList.toggle("empty-state", !messages.length);
  if (!messages.length) {
    container.innerHTML = "Tidak ada pesan teks untuk filter ini.";
    state.lastRenderedGroupId = state.selectedGroupId;
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

  if (!preserveScroll || isNewGroup || wasNearBottom) {
    container.scrollTop = container.scrollHeight;
  } else {
    container.scrollTop = previousScrollTop;
  }
  state.lastRenderedGroupId = state.selectedGroupId;
}

function switchView(view) {
  state.currentView = view;
  const isDashboard = view === "dashboard";
  $("#chat-tab").classList.toggle("active", !isDashboard);
  $("#dashboard-tab").classList.toggle("active", isDashboard);
  $("#chat-sidebar-tools").classList.toggle("hidden", isDashboard);
  $("#chat-view").classList.toggle("hidden", isDashboard);
  $("#inspector-view").classList.toggle("hidden", isDashboard);
  $("#dashboard-view").classList.toggle("hidden", !isDashboard);
  if (isDashboard) {
    loadDailyChanges().catch(() => {});
  }
}

function renderDashboardGroupFilter() {
  const current = $("#dashboard-group-filter").value;
  $("#dashboard-group-filter").innerHTML = `
    <option value="">Semua grup</option>
    ${state.groups
      .map((group) => `<option value="${group.id}">${escapeHtml(group.name)} (${escapeHtml(group.wa_chat_id)})</option>`)
      .join("")}
  `;
  $("#dashboard-group-filter").value = current;
}

async function loadDailyChanges() {
  const params = new URLSearchParams();
  params.set("limit", "300");
  if ($("#dashboard-group-filter").value) params.set("group_id", $("#dashboard-group-filter").value);
  if ($("#dashboard-date-filter").value) params.set("date", $("#dashboard-date-filter").value);
  if ($("#dashboard-keyword-filter").value.trim()) params.set("q", $("#dashboard-keyword-filter").value.trim());
  const data = await api(`/api/daily-changes?${params.toString()}`);
  state.dailyChanges = data.daily_changes || [];
  const summary = summarizeDailyChanges(state.dailyChanges, data.totals || {}, data.pagination || {});
  renderDailyChangeStats(summary);
  renderDashboardInsights(summary);
  renderDailyChangeChart(summary);
  renderDashboardBreakdowns(summary);
  renderDailyChanges(state.dailyChanges);
}

function summarizeDailyChanges(rows, totals, pagination) {
  const dailySeries = countBy(rows, (row) => row.report_date || "-", (row) => row.report_date || "-")
    .map((item) => ({ date: item.key, count: item.count }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const groups = countBy(
    rows,
    (row) => row.group_id,
    (row) => row.group_name || row.wa_chat_id || row.group_id
  );
  const bots = countBy(rows, (row) => row.bot || "-", (row) => row.bot || "-");
  const changers = countBy(rows, (row) => row.changed_by || "-", (row) => row.changed_by || "-");
  const changeTypes = countBy(rows, (row) => row.changed || "-", (row) => row.changed || "-");
  const teachers = countBy(rows, (row) => row.teacher_name || "-", (row) => row.teacher_name || "-");
  const students = countBy(rows, (row) => row.student_name || "-", (row) => row.student_name || "-");
  const latestPoint = dailySeries[dailySeries.length - 1] || { date: "", count: 0 };
  const previousPoint = dailySeries[dailySeries.length - 2] || { date: "", count: 0 };
  const peakPoint = dailySeries.reduce(
    (peak, point) => (point.count > peak.count ? point : peak),
    { date: "", count: 0 }
  );
  const totalRows = Number(totals.rows || rows.length || 0);

  return {
    rows,
    totals,
    pagination,
    dailySeries,
    recentSeries: dailySeries.slice(-14),
    groups,
    bots,
    changers,
    changeTypes,
    teachers,
    students,
    latestPoint,
    previousPoint,
    peakPoint,
    latestDelta: latestPoint.count - previousPoint.count,
    totalRows,
    isTruncated: Number(pagination.returned || rows.length) < totalRows,
  };
}

function renderDailyChangeStats(summary) {
  const topGroup = summary.groups[0];
  const topChangeType = summary.changeTypes[0];
  const latestLabel = summary.latestPoint.date ? formatShortDate(summary.latestPoint.date) : "-";
  $("#daily-change-stats").innerHTML = [
    [compactNumber(summary.totalRows), "Catatan perubahan", summary.isTruncated ? "Agregasi memakai data terbaru" : "Semua data sesuai filter"],
    [compactNumber(summary.totals.groups || summary.groups.length), "Grup terdampak", topGroup ? truncate(topGroup.label, 42) : "Belum ada grup"],
    [compactNumber(summary.latestPoint.count), `Perubahan ${latestLabel}`, formatDelta(summary.latestDelta)],
    [compactNumber(summary.totals.students || summary.students.length), "Murid unik", topChangeType ? `${truncate(topChangeType.label, 34)} dominan` : "Belum ada pola"],
  ]
    .map(
      ([value, label, helper]) => `
        <div class="stat dashboard-stat">
          <span class="stat-value">${escapeHtml(value)}</span>
          <span class="stat-label">${escapeHtml(label)}</span>
          <span class="stat-helper">${escapeHtml(helper)}</span>
        </div>
      `
    )
    .join("");
}

function formatDelta(value) {
  if (!value) return "Sama dengan hari sebelumnya";
  return `${value > 0 ? "+" : ""}${compactNumber(value)} dari hari sebelumnya`;
}

function renderDashboardInsights(summary) {
  const topGroup = summary.groups[0];
  const topBot = summary.bots[0];
  const topChanger = summary.changers[0];
  const peakPoint = summary.peakPoint;
  if (!summary.rows.length) {
    $("#dashboard-insights").innerHTML = `
      <div class="insight-empty">
        Belum ada data perubahan harian untuk filter ini.
      </div>
    `;
    return;
  }

  $("#dashboard-insights").innerHTML = `
    <div class="insight-item">
      <span class="insight-kicker">Puncak aktivitas</span>
      <strong>${escapeHtml(formatShortDate(peakPoint.date))}</strong>
      <span>${compactNumber(peakPoint.count)} catatan perubahan</span>
    </div>
    <div class="insight-item">
      <span class="insight-kicker">Grup paling aktif</span>
      <strong>${escapeHtml(truncate(topGroup?.label || "-", 46))}</strong>
      <span>${compactNumber(topGroup?.count || 0)} catatan terbaru</span>
    </div>
    <div class="insight-item">
      <span class="insight-kicker">Pengubah utama</span>
      <strong>${escapeHtml(truncate(topChanger?.label || "-", 46))}</strong>
      <span>${escapeHtml(truncate(topBot?.label || "-", 36))} paling sering muncul</span>
    </div>
  `;
}

function renderDailyChangeChart(summary) {
  const container = $("#daily-change-chart");
  const caption = $("#daily-change-chart-caption");
  if (!summary.recentSeries.length) {
    container.classList.add("empty-state");
    container.innerHTML = "Belum ada data untuk chart harian.";
    caption.textContent = "";
    return;
  }

  const maxCount = Math.max(...summary.recentSeries.map((point) => point.count), 1);
  container.classList.remove("empty-state");
  container.innerHTML = `
    <div class="daily-chart-bars" style="--chart-count: ${summary.recentSeries.length}">
      ${summary.recentSeries
        .map((point) => {
          const height = Math.max(8, Math.round((point.count / maxCount) * 100));
          return `
            <button class="daily-bar" type="button" data-date="${escapeHtml(point.date)}"
              style="--bar-height: ${height}%"
              aria-label="${escapeHtml(`${point.count} perubahan pada ${point.date}`)}">
              <span class="daily-bar-value">${compactNumber(point.count)}</span>
              <span class="daily-bar-fill"></span>
              <span class="daily-bar-label">${escapeHtml(formatShortDate(point.date))}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
  caption.textContent = summary.isTruncated ? "300 catatan terbaru" : `${summary.recentSeries.length} hari aktif`;
}

function renderDashboardBreakdowns(summary) {
  const container = $("#dashboard-breakdowns");
  if (!summary.rows.length) {
    container.innerHTML = `<div class="empty-state breakdown-empty">Belum ada ranking untuk filter ini.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="breakdown-column">
      <h4>Grup teratas</h4>
      ${renderGroupRanking(summary.groups.slice(0, 5), summary.totalRows)}
    </div>
    <div class="breakdown-column">
      <h4>Jenis perubahan</h4>
      ${renderPlainRanking(summary.changeTypes.slice(0, 5), summary.totalRows)}
    </div>
    <div class="breakdown-column">
      <h4>Bot & pengubah</h4>
      ${renderPlainRanking([...summary.bots.slice(0, 3), ...summary.changers.slice(0, 3)], summary.totalRows)}
    </div>
  `;
}

function renderGroupRanking(items, total) {
  if (!items.length) return `<div class="result-context">Belum ada grup.</div>`;
  return items
    .map((item, index) => {
      const share = Math.max(4, Math.round((item.count / Math.max(total, 1)) * 100));
      return `
        <button class="rank-row dashboard-chat-link" type="button" data-group-id="${escapeHtml(item.key)}">
          <span class="rank-index">${index + 1}</span>
          <span class="rank-copy">
            <strong>${escapeHtml(truncate(item.label, 52))}</strong>
            <span>${compactNumber(item.count)} catatan | terakhir ${escapeHtml(formatShortDate(item.latestDate))}</span>
          </span>
          <span class="rank-meter" aria-hidden="true"><span style="width: ${share}%"></span></span>
        </button>
      `;
    })
    .join("");
}

function renderPlainRanking(items, total) {
  if (!items.length) return `<div class="result-context">Belum ada data.</div>`;
  return items
    .map((item, index) => {
      const share = Math.max(3, Math.round((item.count / Math.max(total, 1)) * 100));
      return `
        <div class="rank-row">
          <span class="rank-index">${index + 1}</span>
          <span class="rank-copy">
            <strong>${escapeHtml(truncate(item.label, 52))}</strong>
            <span>${compactNumber(item.count)} catatan</span>
          </span>
          <span class="rank-meter" aria-hidden="true"><span style="width: ${share}%"></span></span>
        </div>
      `;
    })
    .join("");
}

function renderDailyChanges(rows) {
  const container = $("#daily-change-table");
  if (!rows.length) {
    container.innerHTML = `<tr><td colspan="7" class="table-empty">Belum ada data harian untuk filter ini.</td></tr>`;
    return;
  }
  container.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>
            <button class="daily-group-button" type="button" data-group-id="${escapeHtml(row.group_id)}">
              ${escapeHtml(row.group_id)}
            </button>
            <div class="result-context">${escapeHtml(row.group_name || row.wa_chat_id || "-")}</div>
          </td>
          <td>${escapeHtml(row.report_date || "-")}</td>
          <td>${escapeHtml(row.teacher_name || "-")}</td>
          <td>${escapeHtml(row.student_name || "-")}</td>
          <td>${escapeHtml(row.bot || "-")}</td>
          <td>${escapeHtml(row.changed || "-")}</td>
          <td>${escapeHtml(row.changed_by || "-")}</td>
        </tr>
      `
    )
    .join("");
}

function closeChatModal() {
  $("#chat-modal").classList.add("hidden");
}

function renderChatModalMessages(messages) {
  const container = $("#chat-modal-messages");
  container.classList.toggle("empty-state", !messages.length);
  if (!messages.length) {
    container.innerHTML = "Belum ada pesan teks untuk grup ini.";
    return;
  }
  container.innerHTML = messages
    .map((message) => {
      const senderName = message.sender?.display_name || message.sender_name || "-";
      return `
        <article class="message" data-message-id="${message.id}">
          <div class="message-meta">
            <span class="sender-name">${escapeHtml(senderName)}</span>
            <span class="message-time">${escapeHtml(formatTime(message.wa_timestamp))}</span>
          </div>
          <div class="message-body">${escapeHtml(message.body)}</div>
        </article>
      `;
    })
    .join("");
  container.scrollTop = container.scrollHeight;
}

async function openDashboardChat(groupId) {
  const modal = $("#chat-modal");
  const messagesContainer = $("#chat-modal-messages");
  $("#chat-modal-title").textContent = "Percakapan";
  $("#chat-modal-meta").textContent = groupId;
  messagesContainer.classList.add("empty-state");
  messagesContainer.innerHTML = "Memuat percakapan...";
  modal.classList.remove("hidden");

  try {
    const data = await api(`/api/chats?group_id=${encodeURIComponent(groupId)}&limit=120`);
    const group = data.group || {};
    $("#chat-modal-title").textContent = group.name || "Percakapan";
    $("#chat-modal-meta").textContent = group.wa_chat_id || groupId;
    renderChatModalMessages(data.messages || []);
  } catch (error) {
    messagesContainer.classList.add("empty-state");
    messagesContainer.innerHTML = "Chat untuk Group ID ini belum ditemukan.";
  }
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
$("#chat-tab").addEventListener("click", () => switchView("chat"));
$("#dashboard-tab").addEventListener("click", () => switchView("dashboard"));
$("#refresh-button").addEventListener("click", () => refreshAll());
$("#group-search").addEventListener("input", () => loadGroups().catch(() => {}));
$("#apply-filter").addEventListener("click", () => loadMessages({ preserveScroll: false }));
$("#reset-filter").addEventListener("click", () => {
  $("#message-keyword").value = "";
  $("#sender-filter").value = "";
  $("#from-filter").value = "";
  $("#to-filter").value = "";
  loadMessages({ preserveScroll: false });
});
$("#global-search-button").addEventListener("click", runGlobalSearch);
$("#global-search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") runGlobalSearch();
});
$("#dashboard-refresh-button").addEventListener("click", () => loadDailyChanges());
$("#dashboard-apply-filter").addEventListener("click", () => loadDailyChanges());
$("#dashboard-reset-filter").addEventListener("click", () => {
  $("#dashboard-group-filter").value = "";
  $("#dashboard-date-filter").value = "";
  $("#dashboard-keyword-filter").value = "";
  loadDailyChanges();
});
$("#dashboard-keyword-filter").addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadDailyChanges();
});
$("#dashboard-view").addEventListener("click", (event) => {
  const bar = event.target.closest(".daily-bar");
  if (bar) {
    $("#dashboard-date-filter").value = bar.dataset.date;
    loadDailyChanges();
    return;
  }

  const chatButton = event.target.closest(".dashboard-chat-link, .daily-group-button");
  if (chatButton) openDashboardChat(chatButton.dataset.groupId);
});
$("#chat-modal-close").addEventListener("click", closeChatModal);
$("#chat-modal").addEventListener("click", (event) => {
  if (event.target.id === "chat-modal") closeChatModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#chat-modal").classList.contains("hidden")) {
    closeChatModal();
  }
});

boot().catch(() => show("login"));
