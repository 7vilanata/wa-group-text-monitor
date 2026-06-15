const state = {
  user: null,
  groups: [],
  selectedGroupId: null,
  currentView: "chat",
  contacts: [],
  dailyChanges: [],
  dashboardSection: "summary",
  dashboardDateRange: {
    from: "",
    to: "",
  },
  dailySort: {
    key: "report_date",
    direction: "desc",
  },
  dailyPage: 1,
  dailyPageSize: 20,
  dashboardCalendarMonth: "",
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
  const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (isToday) return clock;
  const dateLabel = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
  }).format(date);
  return `${dateLabel} ${clock}`;
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

function parseIsoDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toIsoDate(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function addMonths(date, count) {
  const next = new Date(date.getFullYear(), date.getMonth() + count, 1);
  return next;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
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

function normalizeValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isYes(value) {
  return ["ya", "yes", "true", "1", "berubah"].includes(normalizeValue(value));
}

function isNo(value) {
  return ["tidak", "no", "false", "0", "tidak ada"].includes(normalizeValue(value));
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((Number(part || 0) / Number(total || 1)) * 100);
}

function renderStatusBadge(value, kind) {
  const raw = String(value || "-");
  const normalized = normalizeValue(raw);
  let tone = "neutral";
  if (kind === "bot") tone = isYes(raw) ? "success" : "muted";
  if (kind === "changed") tone = isYes(raw) ? "warning" : isNo(raw) ? "success" : "neutral";
  if (kind === "changer") {
    if (normalized === "guru") tone = "info";
    else if (normalized === "murid") tone = "warning";
    else if (normalized === "tidak ada") tone = "muted";
  }
  return `<span class="status-chip ${tone}">${escapeHtml(raw)}</span>`;
}

function getMessageSenderName(message) {
  return message.sender?.display_name || message.sender_name || "-";
}

function getMessageSenderKey(message) {
  return message.sender?.wa_contact_id || message.wa_contact_id || message.sender?.id || message.sender_pk || getMessageSenderName(message);
}

function getSenderTone(senderKey) {
  const colors = 6;
  const value = String(senderKey || "");
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash + value.charCodeAt(index) * (index + 1)) % colors;
  }
  return `tone-${hash}`;
}

function renderMessageBubble(message, previousMessage) {
  const senderName = getMessageSenderName(message);
  const senderKey = getMessageSenderKey(message);
  const previousSenderKey = previousMessage ? getMessageSenderKey(previousMessage) : null;
  const isContinuation = senderKey && senderKey === previousSenderKey;
  const senderLabel = isContinuation
    ? ""
    : `<div class="message-meta"><span class="sender-name ${getSenderTone(senderKey)}">${escapeHtml(senderName)}</span></div>`;

  return `
    <article class="message ${isContinuation ? "is-continuation" : ""}" data-message-id="${message.id}">
      ${senderLabel}
      <div class="message-content">
        <div class="message-body">${escapeHtml(message.body)}</div>
        <span class="message-time">${escapeHtml(formatTime(message.wa_timestamp))}</span>
      </div>
    </article>
  `;
}

function ensureDashboardCalendarMonth() {
  if (state.dashboardCalendarMonth) return;
  const base = parseIsoDate(state.dashboardDateRange.from) || new Date();
  state.dashboardCalendarMonth = toIsoDate(startOfMonth(base));
}

function getDashboardRangeLabel() {
  const { from, to } = state.dashboardDateRange;
  if (!from && !to) return "Semua tanggal";
  if (from && !to) return `${formatShortDate(from)} - pilih akhir`;
  if (from === to) return formatShortDate(from);
  return `${formatShortDate(from)} - ${formatShortDate(to)}`;
}

function updateDashboardRangeLabel() {
  $("#dashboard-date-range-label").textContent = getDashboardRangeLabel();
}

function setDashboardRange(from, to = "", { close = false } = {}) {
  const sortedFrom = from && to && to < from ? to : from;
  const sortedTo = from && to && to < from ? from : to;
  state.dashboardDateRange = {
    from: sortedFrom || "",
    to: sortedTo || "",
  };
  if (state.dashboardDateRange.from) {
    state.dashboardCalendarMonth = toIsoDate(startOfMonth(parseIsoDate(state.dashboardDateRange.from)));
  }
  updateDashboardRangeLabel();
  renderDashboardRangePicker();
  if (close) closeDashboardRangePicker();
}

function clearDashboardRange() {
  state.dashboardDateRange = { from: "", to: "" };
  state.dashboardCalendarMonth = toIsoDate(startOfMonth(new Date()));
  updateDashboardRangeLabel();
  renderDashboardRangePicker();
}

function toggleDashboardRangePicker() {
  const popover = $("#dashboard-date-range-popover");
  const willOpen = popover.classList.contains("hidden");
  popover.classList.toggle("hidden", !willOpen);
  $("#dashboard-date-range-trigger").setAttribute("aria-expanded", String(willOpen));
  if (willOpen) renderDashboardRangePicker();
}

function closeDashboardRangePicker() {
  $("#dashboard-date-range-popover").classList.add("hidden");
  $("#dashboard-date-range-trigger").setAttribute("aria-expanded", "false");
}

function renderDashboardRangePicker() {
  const monthsContainer = $("#range-calendar-months");
  if (!monthsContainer) return;
  ensureDashboardCalendarMonth();
  const firstMonth = parseIsoDate(state.dashboardCalendarMonth) || startOfMonth(new Date());
  const secondMonth = addMonths(firstMonth, 1);
  $("#range-calendar-title").textContent = `${formatMonthTitle(firstMonth)} - ${formatMonthTitle(secondMonth)}`;
  monthsContainer.innerHTML = [firstMonth, secondMonth].map(renderCalendarMonth).join("");
}

function formatMonthTitle(date) {
  return new Intl.DateTimeFormat("id-ID", {
    month: "short",
    year: "numeric",
  }).format(date);
}

function renderCalendarMonth(monthDate) {
  const today = toIsoDate(new Date());
  const { from, to } = state.dashboardDateRange;
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const leadingBlankCount = monthStart.getDay();
  const days = [];
  for (let index = 0; index < leadingBlankCount; index += 1) {
    days.push(`<span class="range-day blank" aria-hidden="true"></span>`);
  }
  for (let day = 1; day <= monthEnd.getDate(); day += 1) {
    const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
    const iso = toIsoDate(date);
    const isStart = iso === from;
    const isEnd = iso === to;
    const isSelected = isStart || isEnd || (from && !to && iso === from);
    const isInRange = from && to && iso > from && iso < to;
    const classes = [
      "range-day",
      isSelected ? "selected" : "",
      isStart ? "range-start" : "",
      isEnd ? "range-end" : "",
      isInRange ? "in-range" : "",
      iso === today ? "today" : "",
    ]
      .filter(Boolean)
      .join(" ");
    days.push(
      `<button class="${classes}" type="button" data-range-date="${iso}" aria-label="${escapeHtml(iso)}">${day}</button>`
    );
  }

  return `
    <div class="range-month">
      <strong>${escapeHtml(formatMonthTitle(monthDate))}</strong>
      <div class="range-weekdays" aria-hidden="true">
        <span>Min</span><span>Sen</span><span>Sel</span><span>Rab</span><span>Kam</span><span>Jum</span><span>Sab</span>
      </div>
      <div class="range-days">${days.join("")}</div>
    </div>
  `;
}

function chooseDashboardDate(isoDate) {
  const { from, to } = state.dashboardDateRange;
  if (!from || to) {
    setDashboardRange(isoDate);
    return;
  }
  setDashboardRange(from, isoDate, { close: true });
}

function applyDashboardPreset(value) {
  const today = new Date();
  if (value === "today") {
    const iso = toIsoDate(today);
    setDashboardRange(iso, iso);
    return;
  }
  if (value === "month") {
    setDashboardRange(toIsoDate(startOfMonth(today)), toIsoDate(today));
    return;
  }
  const days = Number(value);
  if (days) {
    setDashboardRange(toIsoDate(addDays(today, -(days - 1))), toIsoDate(today));
  }
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
  await loadGroups();
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
  renderMembers();
}

function formatWhatsAppNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const withoutDomain = raw.includes("@") ? raw.split("@")[0] : raw;
  return withoutDomain || raw;
}

function renderMembers() {
  const container = $("#member-list");
  if (!container) return;
  container.classList.toggle("empty-state", !state.contacts.length);
  if (!state.contacts.length) {
    container.innerHTML = "Belum ada anggota dari pesan yang masuk.";
    return;
  }
  container.innerHTML = state.contacts
    .map(
      (contact) => `
        <div class="member-item">
          <span class="member-name">${escapeHtml(contact.display_name || "-")}</span>
          <span class="member-number">${escapeHtml(formatWhatsAppNumber(contact.wa_contact_id))}</span>
        </div>
      `
    )
    .join("");
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
  container.innerHTML = messages.map((message, index) => renderMessageBubble(message, messages[index - 1])).join("");

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
  $("#app-view").classList.toggle("dashboard-mode", isDashboard);
  $("#chat-tab").classList.toggle("active", !isDashboard);
  $("#dashboard-tab").classList.toggle("active", isDashboard);
  $(".sidebar").classList.toggle("hidden", isDashboard);
  $("#chat-sidebar-tools").classList.toggle("hidden", isDashboard);
  $("#chat-view").classList.toggle("hidden", isDashboard);
  $("#inspector-view").classList.toggle("hidden", isDashboard);
  $("#dashboard-view").classList.toggle("hidden", !isDashboard);
  if (isDashboard) {
    loadDailyChanges().catch(() => {});
  }
}

function switchDashboardSection(section) {
  state.dashboardSection = section;
  const isSummary = section === "summary";
  $("#dashboard-summary-tab").classList.toggle("active", isSummary);
  $("#dashboard-priority-tab").classList.toggle("active", !isSummary);
  $("#dashboard-summary-section").classList.toggle("hidden", !isSummary);
  $("#dashboard-priority-section").classList.toggle("hidden", isSummary);
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
  params.set("limit", "500");
  if ($("#dashboard-group-filter").value) params.set("group_id", $("#dashboard-group-filter").value);
  if (state.dashboardDateRange.from) params.set("from", state.dashboardDateRange.from);
  if (state.dashboardDateRange.to) params.set("to", state.dashboardDateRange.to);
  if ($("#dashboard-keyword-filter").value.trim()) params.set("q", $("#dashboard-keyword-filter").value.trim());
  const data = await api(`/api/daily-changes?${params.toString()}`);
  state.dailyChanges = data.daily_changes || [];
  state.dailyPage = 1;
  const summary = summarizeDailyChanges(state.dailyChanges, data.totals || {}, data.pagination || {});
  renderDailyChangeStats(summary);
  renderDashboardInsights(summary);
  renderDailyChangeChart(summary);
  renderDashboardBreakdowns(summary);
  renderDailyChanges(state.dailyChanges);
}

function summarizeDailyChanges(rows, totals, pagination) {
  const dailyMap = new Map();
  rows.forEach((row) => {
    const date = row.report_date || "-";
    const current = dailyMap.get(date) || { date, count: 0, yes: 0, no: 0, unknown: 0, botActive: 0 };
    current.count += 1;
    if (isYes(row.changed)) current.yes += 1;
    else if (isNo(row.changed)) current.no += 1;
    else current.unknown += 1;
    if (isYes(row.bot)) current.botActive += 1;
    dailyMap.set(date, current);
  });
  const dailySeries = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const groups = countBy(
    rows,
    (row) => row.group_id,
    (row) => row.group_name || row.wa_chat_id || row.group_id
  );
  const changedRows = rows.filter((row) => isYes(row.changed));
  const unchangedRows = rows.filter((row) => isNo(row.changed));
  const botActiveRows = rows.filter((row) => isYes(row.bot));
  const botInactiveRows = rows.filter((row) => isNo(row.bot));
  const bots = countBy(rows, (row) => row.bot || "-", (row) => row.bot || "-");
  const changers = countBy(rows, (row) => row.changed_by || "-", (row) => row.changed_by || "-");
  const changeTypes = countBy(rows, (row) => row.changed || "-", (row) => row.changed || "-");
  const teachers = countBy(rows, (row) => row.teacher_name || "-", (row) => row.teacher_name || "-");
  const changedTeachers = countBy(changedRows, (row) => row.teacher_name || "-", (row) => row.teacher_name || "-");
  const students = countBy(rows, (row) => row.student_name || "-", (row) => row.student_name || "-");
  const changedGroups = countBy(
    changedRows,
    (row) => row.group_id,
    (row) => row.group_name || row.wa_chat_id || row.group_id
  );
  const latestPoint = dailySeries[dailySeries.length - 1] || { date: "", count: 0 };
  const previousPoint = dailySeries[dailySeries.length - 2] || { date: "", count: 0 };
  const peakPoint = dailySeries.reduce(
    (peak, point) => (point.yes > peak.yes ? point : peak),
    { date: "", count: 0, yes: 0, no: 0, unknown: 0 }
  );
  const totalRows = Number(totals.rows || rows.length || 0);
  const changedCount = changedRows.length;
  const unchangedCount = unchangedRows.length;
  const botActiveCount = botActiveRows.length;
  const botInactiveCount = botInactiveRows.length;

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
    changedTeachers,
    students,
    changedGroups,
    latestPoint,
    previousPoint,
    peakPoint,
    latestDelta: (latestPoint.yes || 0) - (previousPoint.yes || 0),
    totalRows,
    changedCount,
    unchangedCount,
    botActiveCount,
    botInactiveCount,
    changedRate: percent(changedCount, rows.length),
    botActiveRate: percent(botActiveCount, rows.length),
    isTruncated: Number(pagination.returned || rows.length) < totalRows,
  };
}

function renderDailyChangeStats(summary) {
  const latestLabel = summary.latestPoint.date ? formatShortDate(summary.latestPoint.date) : "-";
  $("#daily-change-stats").innerHTML = [
    [compactNumber(summary.totalRows), "Catatan dicek", summary.isTruncated ? "Agregasi memakai data terbaru" : `${compactNumber(summary.groups.length)} grup dalam filter`],
    [`${summary.changedRate}%`, "Berubah = Ya", `${compactNumber(summary.changedCount)} Ya, ${compactNumber(summary.unchangedCount)} Tidak`],
    [`${summary.botActiveRate}%`, "Bot aktif", `${compactNumber(summary.botActiveCount)} true, ${compactNumber(summary.botInactiveCount)} false`],
    [compactNumber(summary.latestPoint.yes || 0), `Ya pada ${latestLabel}`, formatDelta(summary.latestDelta)],
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
  const topChangedGroup = summary.changedGroups[0] || summary.groups[0];
  const topChangedTeacher = summary.changedTeachers[0] || summary.teachers[0];
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
      <span class="insight-kicker">Puncak berubah</span>
      <strong>${escapeHtml(formatShortDate(peakPoint.date))}</strong>
      <span>${compactNumber(peakPoint.yes)} Ya dari ${compactNumber(peakPoint.count)} catatan</span>
    </div>
    <div class="insight-item">
      <span class="insight-kicker">Guru paling sering berubah</span>
      <strong>${escapeHtml(truncate(topChangedTeacher?.label || "-", 46))}</strong>
      <span>${compactNumber(topChangedTeacher?.count || 0)} catatan Berubah = Ya</span>
    </div>
    <div class="insight-item">
      <span class="insight-kicker">Grup prioritas</span>
      <strong>${escapeHtml(truncate(topChangedGroup?.label || "-", 46))}</strong>
      <span>${escapeHtml(truncate(topChanger?.label || "-", 32))} pengubah paling dominan</span>
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
          const yesShare = percent(point.yes, point.count);
          const noShare = percent(point.no, point.count);
          const unknownShare = Math.max(0, 100 - yesShare - noShare);
          return `
            <button class="daily-bar" type="button" data-date="${escapeHtml(point.date)}"
              style="--bar-height: ${height}%"
              aria-label="${escapeHtml(`${point.yes} Ya, ${point.no} Tidak pada ${point.date}`)}">
              <span class="daily-bar-value">${compactNumber(point.yes)} Ya</span>
              <span class="daily-bar-fill stacked-bar">
                <span class="stack-segment yes" style="height: ${Math.max(point.yes ? 8 : 0, yesShare)}%"></span>
                <span class="stack-segment no" style="height: ${Math.max(point.no ? 8 : 0, noShare)}%"></span>
                <span class="stack-segment unknown" style="height: ${Math.max(point.unknown ? 8 : 0, unknownShare)}%"></span>
              </span>
              <span class="daily-bar-label">${escapeHtml(formatShortDate(point.date))}</span>
            </button>
          `;
        })
        .join("")}
    </div>
    <div class="chart-legend" aria-hidden="true">
      <span><i class="yes"></i>Ya</span>
      <span><i class="no"></i>Tidak</span>
      <span><i class="unknown"></i>Kosong</span>
    </div>
  `;
  caption.textContent = summary.isTruncated
    ? "300 catatan terbaru"
    : `${compactNumber(summary.changedCount)} Ya dari ${compactNumber(summary.rows.length)} catatan`;
}

function renderDashboardBreakdowns(summary) {
  const container = $("#dashboard-breakdowns");
  if (!summary.rows.length) {
    container.innerHTML = `<div class="empty-state breakdown-empty">Belum ada ranking untuk filter ini.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="breakdown-column">
      <h4>Grup sering berubah</h4>
      ${renderGroupRanking(summary.changedGroups.slice(0, 5), Math.max(summary.changedCount, 1), "Ya")}
    </div>
    <div class="breakdown-column">
      <h4>Pengubah</h4>
      ${renderPlainRanking(summary.changers.slice(0, 5), summary.rows.length)}
    </div>
    <div class="breakdown-column">
      <h4>Guru sering berubah</h4>
      ${renderPlainRanking(summary.changedTeachers.slice(0, 5), Math.max(summary.changedCount, 1))}
    </div>
  `;
}

function renderGroupRanking(items, total, suffix = "catatan") {
  if (!items.length) return `<div class="result-context">Belum ada grup dengan Berubah = Ya.</div>`;
  return items
    .map((item, index) => {
      const share = Math.max(4, Math.round((item.count / Math.max(total, 1)) * 100));
      return `
        <button class="rank-row dashboard-chat-link" type="button" data-group-id="${escapeHtml(item.key)}">
          <span class="rank-index">${index + 1}</span>
          <span class="rank-copy">
            <strong>${escapeHtml(truncate(item.label, 52))}</strong>
            <span>${compactNumber(item.count)} ${escapeHtml(suffix)} | terakhir ${escapeHtml(formatShortDate(item.latestDate))}</span>
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

function getDailySortValue(row, key) {
  return String(row[key] ?? "").trim();
}

function sortDailyChanges(rows) {
  const { key, direction } = state.dailySort;
  const multiplier = direction === "asc" ? 1 : -1;
  const collator = new Intl.Collator("id", {
    numeric: true,
    sensitivity: "base",
  });
  return rows
    .map((row, index) => ({ row, index }))
    .sort((leftItem, rightItem) => {
      const left = getDailySortValue(leftItem.row, key);
      const right = getDailySortValue(rightItem.row, key);
      const result = collator.compare(left, right);
      if (result) return result * multiplier;
      return leftItem.index - rightItem.index;
    })
    .map((item) => item.row);
}

function updateDailySortHeaders() {
  document.querySelectorAll("[data-daily-sort]").forEach((button) => {
    const isActive = button.dataset.dailySort === state.dailySort.key;
    button.classList.toggle("active", isActive);
    button.classList.toggle("asc", isActive && state.dailySort.direction === "asc");
    button.classList.toggle("desc", isActive && state.dailySort.direction === "desc");
    button.setAttribute("aria-pressed", String(isActive));
    const header = button.closest("th");
    if (header) {
      header.setAttribute("aria-sort", isActive ? (state.dailySort.direction === "asc" ? "ascending" : "descending") : "none");
    }
  });
}

function updateDailyPagination(totalRows) {
  const pageCount = Math.max(1, Math.ceil(totalRows / state.dailyPageSize));
  state.dailyPage = Math.min(Math.max(state.dailyPage, 1), pageCount);
  const start = totalRows ? (state.dailyPage - 1) * state.dailyPageSize + 1 : 0;
  const end = Math.min(state.dailyPage * state.dailyPageSize, totalRows);
  $("#daily-page-size").value = String(state.dailyPageSize);
  $("#daily-page-info").textContent = totalRows
    ? `${start}-${end} dari ${totalRows} data | Halaman ${state.dailyPage}/${pageCount}`
    : "0 data";
  $("#daily-prev-page").disabled = state.dailyPage <= 1;
  $("#daily-next-page").disabled = state.dailyPage >= pageCount;
}

function renderDailyChanges(rows) {
  const container = $("#daily-change-table");
  updateDailySortHeaders();
  updateDailyPagination(rows.length);
  if (!rows.length) {
    container.innerHTML = `<tr><td colspan="7" class="table-empty">Belum ada data harian untuk filter ini.</td></tr>`;
    return;
  }
  const startIndex = (state.dailyPage - 1) * state.dailyPageSize;
  const visibleRows = sortDailyChanges(rows).slice(startIndex, startIndex + state.dailyPageSize);
  container.innerHTML = visibleRows
    .map((row) => {
      const context = row.group_name || row.wa_chat_id || "";
      return `
        <tr>
          <td>
            <button class="daily-group-button" type="button" data-group-id="${escapeHtml(row.group_id)}">
              ${escapeHtml(row.group_id)}
            </button>
            ${context ? `<div class="result-context">${escapeHtml(context)}</div>` : ""}
          </td>
          <td class="date-cell">${escapeHtml(row.report_date || "-")}</td>
          <td>${escapeHtml(row.teacher_name || "-")}</td>
          <td>${escapeHtml(row.student_name || "-")}</td>
          <td>${renderStatusBadge(row.bot, "bot")}</td>
          <td>${renderStatusBadge(row.changed, "changed")}</td>
          <td>${renderStatusBadge(row.changed_by, "changer")}</td>
        </tr>
      `;
    })
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
  container.innerHTML = messages.map((message, index) => renderMessageBubble(message, messages[index - 1])).join("");
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

$("#login-form").addEventListener("submit", login);
$("#logout-button").addEventListener("click", logout);
$("#chat-tab").addEventListener("click", () => switchView("chat"));
$("#dashboard-tab").addEventListener("click", () => switchView("dashboard"));
$("#refresh-button").addEventListener("click", () => refreshAll());
$("#group-search").addEventListener("input", () => loadGroups().catch(() => {}));
$("#message-keyword").addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadMessages({ preserveScroll: false });
});
$("#from-filter").addEventListener("change", () => loadMessages({ preserveScroll: false }));
$("#to-filter").addEventListener("change", () => loadMessages({ preserveScroll: false }));
$("#reset-filter").addEventListener("click", () => {
  $("#message-keyword").value = "";
  $("#from-filter").value = "";
  $("#to-filter").value = "";
  loadMessages({ preserveScroll: false });
});
$("#global-search-button").addEventListener("click", runGlobalSearch);
$("#global-search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") runGlobalSearch();
});
$("#dashboard-apply-filter").addEventListener("click", () => loadDailyChanges());
$("#dashboard-summary-tab").addEventListener("click", () => switchDashboardSection("summary"));
$("#dashboard-priority-tab").addEventListener("click", () => switchDashboardSection("priority"));
$("#dashboard-reset-filter").addEventListener("click", () => {
  $("#dashboard-group-filter").value = "";
  clearDashboardRange();
  $("#dashboard-keyword-filter").value = "";
  loadDailyChanges();
});
$("#dashboard-keyword-filter").addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadDailyChanges();
});
document.querySelectorAll("[data-daily-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.dailySort;
    if (state.dailySort.key === key) {
      state.dailySort.direction = state.dailySort.direction === "asc" ? "desc" : "asc";
    } else {
      state.dailySort = { key, direction: "asc" };
    }
    state.dailyPage = 1;
    renderDailyChanges(state.dailyChanges);
  });
});
$("#daily-page-size").addEventListener("change", () => {
  state.dailyPageSize = Number($("#daily-page-size").value) || 20;
  state.dailyPage = 1;
  renderDailyChanges(state.dailyChanges);
});
$("#daily-prev-page").addEventListener("click", () => {
  state.dailyPage -= 1;
  renderDailyChanges(state.dailyChanges);
});
$("#daily-next-page").addEventListener("click", () => {
  state.dailyPage += 1;
  renderDailyChanges(state.dailyChanges);
});
$("#dashboard-date-range-trigger").addEventListener("click", toggleDashboardRangePicker);
$("#range-prev-month").addEventListener("click", () => {
  ensureDashboardCalendarMonth();
  state.dashboardCalendarMonth = toIsoDate(addMonths(parseIsoDate(state.dashboardCalendarMonth), -1));
  renderDashboardRangePicker();
});
$("#range-next-month").addEventListener("click", () => {
  ensureDashboardCalendarMonth();
  state.dashboardCalendarMonth = toIsoDate(addMonths(parseIsoDate(state.dashboardCalendarMonth), 1));
  renderDashboardRangePicker();
});
$("#dashboard-date-range-popover").addEventListener("click", (event) => {
  event.stopPropagation();
  const presetButton = event.target.closest("[data-range-preset]");
  if (presetButton) {
    applyDashboardPreset(presetButton.dataset.rangePreset);
    return;
  }

  const dateButton = event.target.closest("[data-range-date]");
  if (dateButton) chooseDashboardDate(dateButton.dataset.rangeDate);
});
$("#dashboard-view").addEventListener("click", (event) => {
  const bar = event.target.closest(".daily-bar");
  if (bar) {
    setDashboardRange(bar.dataset.date, bar.dataset.date);
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
  if (event.key === "Escape") closeDashboardRangePicker();
  if (event.key === "Escape" && !$("#chat-modal").classList.contains("hidden")) {
    closeChatModal();
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest("#dashboard-date-range")) closeDashboardRangePicker();
});

clearDashboardRange();
boot().catch(() => show("login"));
