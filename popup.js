import {
  STORAGE_KEYS,
  DEFAULT_CATEGORIES,
  GROUP_COLORS,
  getCategories,
  saveCategories,
  colorForLabel,
  groupWindowTabs,
  sortWindowTabs,
  findDuplicateTabs,
  ungroupSingleTabGroups,
  runCleanUp,
  mergeAllWindowsInto
} from "./utils.js";

const statsText = document.getElementById("statsText");
const statusBar = document.getElementById("statusBar");
const toggleAutoGroup = document.getElementById("toggleAutoGroup");
const toggleActiveAtEnd = document.getElementById("toggleActiveAtEnd");
const toggleAutoUngroupSingle = document.getElementById("toggleAutoUngroupSingle");

// Duplicate preview elements
const duplicatePanel = document.getElementById("duplicatePanel");
const dupPanelTitle = document.getElementById("dupPanelTitle");
const duplicateList = document.getElementById("duplicateList");
const btnConfirmDuplicates = document.getElementById("btnConfirmDuplicates");

// Category rules elements
const btnToggleRules = document.getElementById("btnToggleRules");
const rulesArrow = document.getElementById("rulesArrow");
const rulesPanel = document.getElementById("rulesPanel");
const categorySelect = document.getElementById("categorySelect");
const categoryEnabled = document.getElementById("categoryEnabled");
const patternChips = document.getElementById("patternChips");
const newPatternInput = document.getElementById("newPatternInput");
const newCategoryInput = document.getElementById("newCategoryInput");

// Sessions elements
const sessionNameInput = document.getElementById("sessionNameInput");
const sessionList = document.getElementById("sessionList");

let statusTimer = null;
let cachedCategories = [];
let selectedCategoryId = null;

function setStatus(message) {
  statusBar.textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusBar.textContent = "Ready";
  }, 4000);
}

async function getCurrentWindow() {
  return chrome.windows.getCurrent({ populate: false });
}

async function refreshStats() {
  const [currentWin, allWindows, allTabs] = await Promise.all([
    getCurrentWindow(),
    chrome.windows.getAll({ windowTypes: ["normal"] }),
    chrome.tabs.query({})
  ]);
  const winTabs = allTabs.filter((t) => t.windowId === currentWin.id);
  statsText.textContent = `${winTabs.length} tabs here • ${allTabs.length} total (${allWindows.length} win)`;
}

/* -------------------------------------------
   1. Clean Up & Organize Actions
-------------------------------------------- */
async function handleCleanUp() {
  const win = await getCurrentWindow();
  const res = await runCleanUp(win.id);
  await refreshStats();
  setStatus(
    `Cleaned: -${res.closedNewTabs} new tabs, -${res.closedDuplicates} dupes, grouped ${res.groupedCount}.`
  );
}

async function handleGroupAndSort() {
  const win = await getCurrentWindow();
  const { groupedCount, newGroups } = await groupWindowTabs(win.id, { sortAfter: true });
  setStatus(
    groupedCount > 0
      ? `Grouped ${groupedCount} tabs (${newGroups} new) & sorted.`
      : "Sorted tabs (no new 2+ matches to group)."
  );
}

async function handleSort(mode) {
  const win = await getCurrentWindow();
  const { sortedCount } = await sortWindowTabs(win.id, mode);
  setStatus(`Sorted ${sortedCount} tabs by ${mode}.`);
}

async function setAllGroupsCollapsed(collapsed) {
  const win = await getCurrentWindow();
  const groups = await chrome.tabGroups.query({ windowId: win.id });
  if (groups.length === 0) {
    setStatus("No tab groups in this window.");
    return;
  }
  for (const g of groups) {
    await chrome.tabGroups.update(g.id, { collapsed });
  }
  setStatus(`${collapsed ? "Collapsed" : "Expanded"} ${groups.length} group(s).`);
}

async function ungroupAndSortByTitle() {
  const win = await getCurrentWindow();
  const tabs = await chrome.tabs.query({ windowId: win.id, pinned: false });
  const groupedIds = tabs
    .filter((t) => t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
    .map((t) => t.id);

  if (groupedIds.length > 0) {
    await chrome.tabs.ungroup(groupedIds);
  }
  await sortWindowTabs(win.id, "title");
  setStatus(`Ungrouped ${groupedIds.length} tabs & sorted by title.`);
}

/* -------------------------------------------
   2. Safe Duplicate Preview
-------------------------------------------- */
async function openDuplicatePreview() {
  const win = await getCurrentWindow();
  const duplicates = await findDuplicateTabs(win.id);

  if (duplicates.length === 0) {
    duplicatePanel.classList.add("hidden");
    setStatus("No duplicate tabs in this window.");
    return;
  }

  duplicateList.textContent = "";
  dupPanelTitle.textContent = `${duplicates.length} Duplicate Tab${duplicates.length > 1 ? "s" : ""} Found`;

  for (const tab of duplicates) {
    const li = document.createElement("li");
    li.className = "dup-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.tabId = String(tab.id);

    const info = document.createElement("div");
    info.className = "dup-info";

    const titleEl = document.createElement("div");
    titleEl.className = "dup-title";
    titleEl.textContent = tab.title || "Untitled";

    const urlEl = document.createElement("div");
    urlEl.className = "dup-url";
    urlEl.textContent = tab.url || tab.pendingUrl || "";

    info.appendChild(titleEl);
    info.appendChild(urlEl);
    li.appendChild(checkbox);
    li.appendChild(info);
    duplicateList.appendChild(li);
  }

  updateConfirmDupButton();
  duplicatePanel.classList.remove("hidden");
}

function updateConfirmDupButton() {
  const checked = duplicateList.querySelectorAll('input[type="checkbox"]:checked').length;
  btnConfirmDuplicates.textContent = `Close ${checked} Tab${checked === 1 ? "" : "s"}`;
  btnConfirmDuplicates.disabled = checked === 0;
}

async function confirmCloseDuplicates() {
  const checkedBoxes = duplicateList.querySelectorAll('input[type="checkbox"]:checked');
  const ids = Array.from(checkedBoxes).map((cb) => Number(cb.dataset.tabId));

  if (ids.length > 0) {
    await chrome.tabs.remove(ids);
    setStatus(`Closed ${ids.length} duplicate tab${ids.length === 1 ? "" : "s"}.`);
  }
  duplicatePanel.classList.add("hidden");
  await refreshStats();
}

/* -------------------------------------------
   3. Category Rules Editor
-------------------------------------------- */
async function renderCategoryRules() {
  cachedCategories = await getCategories();

  if (!selectedCategoryId || !cachedCategories.some((c) => c.id === selectedCategoryId)) {
    selectedCategoryId = cachedCategories[0]?.id || null;
  }

  categorySelect.textContent = "";
  for (const cat of cachedCategories) {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = `${cat.name} (${cat.patterns.length})${cat.enabled ? "" : " [Off]"}`;
    categorySelect.appendChild(opt);
  }

  if (selectedCategoryId) {
    categorySelect.value = selectedCategoryId;
  }

  const currentCat = cachedCategories.find((c) => c.id === selectedCategoryId);
  patternChips.textContent = "";

  if (!currentCat) {
    categoryEnabled.checked = false;
    categoryEnabled.disabled = true;
    return;
  }

  categoryEnabled.disabled = false;
  categoryEnabled.checked = Boolean(currentCat.enabled);

  if (currentCat.patterns.length === 0) {
    const empty = document.createElement("span");
    empty.className = "panel-note";
    empty.textContent = "No domains or keywords yet. Add one below.";
    patternChips.appendChild(empty);
    return;
  }

  for (const pattern of currentCat.patterns) {
    const chip = document.createElement("span");
    chip.className = "chip";

    const label = document.createElement("span");
    label.textContent = pattern;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.title = `Remove ${pattern}`;
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", async () => {
      currentCat.patterns = currentCat.patterns.filter((p) => p !== pattern);
      await saveCategories(cachedCategories);
      await renderCategoryRules();
      setStatus(`Removed "${pattern}" from ${currentCat.name}.`);
    });

    chip.appendChild(label);
    chip.appendChild(removeBtn);
    patternChips.appendChild(chip);
  }
}

async function handleAddPatterns() {
  const currentCat = cachedCategories.find((c) => c.id === selectedCategoryId);
  if (!currentCat) return;

  const raw = newPatternInput.value.trim();
  if (!raw) return;

  const entries = raw
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, ""))
    .filter((s) => s.length >= 2);

  let added = 0;
  for (const entry of entries) {
    if (!currentCat.patterns.includes(entry)) {
      currentCat.patterns.push(entry);
      added++;
    }
  }

  if (added > 0) {
    await saveCategories(cachedCategories);
    await renderCategoryRules();
    setStatus(`Added ${added} rule(s) to ${currentCat.name}.`);
  }
  newPatternInput.value = "";
}

async function handleCreateCategory() {
  const name = newCategoryInput.value.trim();
  if (!name) return;

  const id = `custom_${Date.now()}`;
  const color = GROUP_COLORS[cachedCategories.length % GROUP_COLORS.length] || colorForLabel(name);

  cachedCategories.push({
    id,
    name,
    enabled: true,
    color,
    patterns: []
  });

  selectedCategoryId = id;
  await saveCategories(cachedCategories);
  newCategoryInput.value = "";
  await renderCategoryRules();
  setStatus(`Created category "${name}".`);
}

async function handleDeleteCategory() {
  if (!selectedCategoryId) return;
  const target = cachedCategories.find((c) => c.id === selectedCategoryId);
  cachedCategories = cachedCategories.filter((c) => c.id !== selectedCategoryId);
  selectedCategoryId = cachedCategories[0]?.id || null;
  await saveCategories(cachedCategories);
  await renderCategoryRules();
  if (target) setStatus(`Deleted category "${target.name}".`);
}

/* -------------------------------------------
   4. Toggles & Merge Windows
-------------------------------------------- */
async function loadToggles() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.AUTO_GROUP,
    STORAGE_KEYS.AUTO_UNGROUP_SINGLE,
    STORAGE_KEYS.ACTIVE_AT_END
  ]);
  toggleAutoGroup.checked = Boolean(data[STORAGE_KEYS.AUTO_GROUP]);
  toggleAutoUngroupSingle.checked = Boolean(data[STORAGE_KEYS.AUTO_UNGROUP_SINGLE]);
  toggleActiveAtEnd.checked = Boolean(data[STORAGE_KEYS.ACTIVE_AT_END]);
}

async function handleMergeWindows() {
  const win = await getCurrentWindow();
  const { mergedWindows, movedTabs } = await mergeAllWindowsInto(win.id);
  if (mergedWindows === 0) {
    setStatus("Only one normal window is open.");
  } else {
    setStatus(`Merged ${mergedWindows} window(s) (${movedTabs} tabs).`);
  }
  await refreshStats();
}

/* -------------------------------------------
   5. Local Saved Sessions
-------------------------------------------- */
async function getSavedSessions() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SESSIONS);
  return Array.isArray(data[STORAGE_KEYS.SESSIONS]) ? data[STORAGE_KEYS.SESSIONS] : [];
}

async function renderSessions() {
  const sessions = await getSavedSessions();
  sessionList.textContent = "";

  if (sessions.length === 0) {
    const empty = document.createElement("li");
    empty.className = "session-empty";
    empty.textContent = "No saved sessions yet.";
    sessionList.appendChild(empty);
    return;
  }

  for (const session of sessions) {
    const li = document.createElement("li");
    li.className = "session-item";

    const meta = document.createElement("div");
    meta.className = "session-meta";

    const nameEl = document.createElement("div");
    nameEl.className = "session-name";
    nameEl.textContent = session.name;

    const subEl = document.createElement("div");
    subEl.className = "session-sub";
    const dateStr = new Date(session.createdAt).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    subEl.textContent = `${session.tabs.length} tabs • ${dateStr}`;

    meta.appendChild(nameEl);
    meta.appendChild(subEl);

    const actions = document.createElement("div");
    actions.className = "session-actions";

    const restoreBtn = document.createElement("button");
    restoreBtn.className = "btn btn-sm";
    restoreBtn.textContent = "Restore";
    restoreBtn.addEventListener("click", () => restoreSession(session));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-sm";
    deleteBtn.textContent = "Del";
    deleteBtn.addEventListener("click", () => deleteSession(session.id));

    actions.appendChild(restoreBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(meta);
    li.appendChild(actions);
    sessionList.appendChild(li);
  }
}

async function saveCurrentSession() {
  const win = await getCurrentWindow();
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId: win.id }),
    chrome.tabGroups.query({ windowId: win.id })
  ]);

  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const serializedTabs = tabs
    .filter((t) => Boolean(t.url || t.pendingUrl))
    .map((t) => {
      const group = groupMap.get(t.groupId);
      return {
        url: t.url || t.pendingUrl,
        title: t.title || "",
        pinned: Boolean(t.pinned),
        groupKey: group ? String(group.id) : null,
        groupTitle: group ? group.title || "" : null,
        groupColor: group ? group.color : null
      };
    });

  if (serializedTabs.length === 0) {
    setStatus("No tabs to save.");
    return;
  }

  const rawName = sessionNameInput.value.trim();
  const fallbackName = `Session ${new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  })}`;

  const newSession = {
    id: crypto.randomUUID(),
    name: rawName || fallbackName,
    createdAt: Date.now(),
    tabs: serializedTabs
  };

  const sessions = await getSavedSessions();
  sessions.unshift(newSession);
  await chrome.storage.local.set({ [STORAGE_KEYS.SESSIONS]: sessions });

  sessionNameInput.value = "";
  await renderSessions();
  setStatus(`Saved "${newSession.name}" (${serializedTabs.length} tabs).`);
}

async function restoreSession(session) {
  if (!session.tabs || session.tabs.length === 0) return;

  const first = session.tabs[0];
  const newWin = await chrome.windows.create({ url: first.url });
  const createdTabs = [];

  if (newWin.tabs && newWin.tabs[0]) {
    if (first.pinned) {
      await chrome.tabs.update(newWin.tabs[0].id, { pinned: true });
    }
    createdTabs.push({ id: newWin.tabs[0].id, meta: first });
  }

  for (let i = 1; i < session.tabs.length; i++) {
    const item = session.tabs[i];
    try {
      const created = await chrome.tabs.create({
        windowId: newWin.id,
        url: item.url,
        pinned: Boolean(item.pinned),
        active: false
      });
      createdTabs.push({ id: created.id, meta: item });
    } catch {
      // Skip invalid/restricted URLs
    }
  }

  const groupsToCreate = new Map();
  for (const entry of createdTabs) {
    if (entry.meta.pinned || !entry.meta.groupKey) continue;
    if (!groupsToCreate.has(entry.meta.groupKey)) {
      groupsToCreate.set(entry.meta.groupKey, {
        title: entry.meta.groupTitle || "",
        color: entry.meta.groupColor || "grey",
        tabIds: []
      });
    }
    groupsToCreate.get(entry.meta.groupKey).tabIds.push(entry.id);
  }

  for (const groupInfo of groupsToCreate.values()) {
    if (groupInfo.tabIds.length === 0) continue;
    try {
      const groupId = await chrome.tabs.group({
        tabIds: groupInfo.tabIds,
        createProperties: { windowId: newWin.id }
      });
      await chrome.tabGroups.update(groupId, {
        title: groupInfo.title,
        color: groupInfo.color
      });
    } catch {
      // Ignore grouping failures
    }
  }

  setStatus(`Restored "${session.name}".`);
}

async function deleteSession(sessionId) {
  const sessions = await getSavedSessions();
  const filtered = sessions.filter((s) => s.id !== sessionId);
  await chrome.storage.local.set({ [STORAGE_KEYS.SESSIONS]: filtered });
  await renderSessions();
  setStatus("Deleted session.");
}

/* -------------------------------------------
   Event Listeners & Init
-------------------------------------------- */
document.getElementById("btnCleanUp").addEventListener("click", handleCleanUp);
document.getElementById("btnGroupDomain").addEventListener("click", handleGroupAndSort);
document.getElementById("btnFindDuplicates").addEventListener("click", openDuplicatePreview);
document.getElementById("btnSortDomain").addEventListener("click", () => handleSort("domain"));
document.getElementById("btnSortTitle").addEventListener("click", () => handleSort("title"));
document.getElementById("btnExpandAll").addEventListener("click", () => setAllGroupsCollapsed(false));
document.getElementById("btnCollapseAll").addEventListener("click", () => setAllGroupsCollapsed(true));
document.getElementById("btnUngroupSort").addEventListener("click", ungroupAndSortByTitle);
document.getElementById("btnMergeWindows").addEventListener("click", handleMergeWindows);
document.getElementById("btnSaveSession").addEventListener("click", saveCurrentSession);

toggleAutoGroup.addEventListener("change", async () => {
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTO_GROUP]: toggleAutoGroup.checked });
  setStatus(toggleAutoGroup.checked ? "Auto-group tabs ON." : "Auto-group tabs OFF.");
});

toggleActiveAtEnd.addEventListener("change", async () => {
  await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_AT_END]: toggleActiveAtEnd.checked });
  setStatus(
    toggleActiveAtEnd.checked
      ? "Sort order: Active group/tab placed at end."
      : "Sort order: Pure alphabetical."
  );
});

toggleAutoUngroupSingle.addEventListener("change", async () => {
  const enabled = toggleAutoUngroupSingle.checked;
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTO_UNGROUP_SINGLE]: enabled });

  if (enabled) {
    const win = await getCurrentWindow();
    const ungrouped = await ungroupSingleTabGroups(win.id);
    setStatus(
      ungrouped > 0
        ? `Auto-ungroup ON (ungrouped ${ungrouped} single-tab group${ungrouped === 1 ? "" : "s"}).`
        : "Auto-ungroup 1-tab groups ON."
    );
  } else {
    setStatus("Auto-ungroup 1-tab groups OFF.");
  }
});

duplicateList.addEventListener("change", updateConfirmDupButton);
btnConfirmDuplicates.addEventListener("click", confirmCloseDuplicates);
document.getElementById("btnCancelDuplicates").addEventListener("click", () => {
  duplicatePanel.classList.add("hidden");
});
document.getElementById("btnCloseDupPanel").addEventListener("click", () => {
  duplicatePanel.classList.add("hidden");
});

// Rules accordion & controls
btnToggleRules.addEventListener("click", () => {
  const isHidden = rulesPanel.classList.toggle("hidden");
  btnToggleRules.setAttribute("aria-expanded", String(!isHidden));
  rulesArrow.textContent = isHidden ? "▸" : "▾";
});

categorySelect.addEventListener("change", async () => {
  selectedCategoryId = categorySelect.value;
  await renderCategoryRules();
});

categoryEnabled.addEventListener("change", async () => {
  const cat = cachedCategories.find((c) => c.id === selectedCategoryId);
  if (!cat) return;
  cat.enabled = categoryEnabled.checked;
  await saveCategories(cachedCategories);
  await renderCategoryRules();
  setStatus(`${cat.name} ${cat.enabled ? "enabled" : "disabled"}.`);
});

document.getElementById("btnAddPattern").addEventListener("click", handleAddPatterns);
newPatternInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAddPatterns();
});

document.getElementById("btnCreateCategory").addEventListener("click", handleCreateCategory);
newCategoryInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleCreateCategory();
});

document.getElementById("btnDeleteCategory").addEventListener("click", handleDeleteCategory);
document.getElementById("btnResetRules").addEventListener("click", async () => {
  await saveCategories(structuredClone(DEFAULT_CATEGORIES));
  selectedCategoryId = DEFAULT_CATEGORIES[0].id;
  await renderCategoryRules();
  setStatus("Restored default category rules.");
});

sessionNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveCurrentSession();
});

// Initialize popup
await Promise.all([refreshStats(), loadToggles(), renderCategoryRules(), renderSessions()]);