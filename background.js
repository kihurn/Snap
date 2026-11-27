import {
  STORAGE_KEYS,
  getCategories,
  getAutoUngroupSingle,
  matchTabToRule,
  findMatchingGroupInWindow,
  setGroupRuleMapping,
  removeGroupRuleMapping,
  ungroupSingleTabGroups,
  runCleanUp,
  mergeAllWindowsInto
} from "./utils.js";

const windowLocks = new Map();
const ungroupRetryTimers = new Map();
const groupRetryTimers = new Map();
const justCreatedGroups = new Map(); // groupId -> expiresAt timestamp
let badgeTimer = null;

function withWindowLock(windowId, fn) {
  const prev = windowLocks.get(windowId) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (windowLocks.get(windowId) === next) {
      windowLocks.delete(windowId);
    }
  });
  windowLocks.set(windowId, next);
  return next;
}

function isDragLockError(err) {
  const msg = (err?.message || "").toLowerCase();
  return msg.includes("cannot be edited right now") || msg.includes("dragging");
}

async function flashBadge(text, color = "#18181b") {
  clearTimeout(badgeTimer);
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    badgeTimer = setTimeout(() => {
      chrome.action.setBadgeText({ text: "" }).catch(() => { });
    }, 3000);
  } catch {
    // Ignore badge errors
  }
}

async function isAutoGroupEnabled() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.AUTO_GROUP);
  return Boolean(data[STORAGE_KEYS.AUTO_GROUP]);
}

function getActiveSkipSet() {
  const now = Date.now();
  const skip = new Set();
  for (const [groupId, expiresAt] of justCreatedGroups.entries()) {
    if (expiresAt > now) {
      skip.add(groupId);
    } else {
      justCreatedGroups.delete(groupId);
    }
  }
  return skip;
}

async function triggerAutoUngroup(windowId, attempt = 0) {
  if (!(await getAutoUngroupSingle())) return;

  let shouldRetry = false;

  await withWindowLock(windowId, async () => {
    try {
      const beforeSkip = getActiveSkipSet();
      const skip = new Set(beforeSkip);
      await ungroupSingleTabGroups(windowId, skip);
      for (const id of beforeSkip) {
        if (!skip.has(id)) justCreatedGroups.delete(id);
      }
    } catch (err) {
      if (isDragLockError(err)) {
        shouldRetry = true;
      }
    }
  });

  if (shouldRetry && attempt < 60) {
    clearTimeout(ungroupRetryTimers.get(windowId));
    const timer = setTimeout(() => {
      ungroupRetryTimers.delete(windowId);
      triggerAutoUngroup(windowId, attempt + 1).catch((err) =>
        console.error("Auto-ungroup retry failed:", err)
      );
    }, 80);
    ungroupRetryTimers.set(windowId, timer);
  }
}

async function processAutoGroupTab(tabId) {
  const latestTab = await chrome.tabs.get(tabId);
  if (
    !latestTab ||
    latestTab.pinned ||
    latestTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
  ) {
    return;
  }

  const categories = await getCategories();
  const rule = matchTabToRule(latestTab, categories);
  if (!rule) return;

  const existingGroups = await chrome.tabGroups.query({ windowId: latestTab.windowId });
  const existingGroup = await findMatchingGroupInWindow(
    latestTab.windowId,
    rule,
    existingGroups
  );

  if (existingGroup) {
    await chrome.tabs.group({
      groupId: existingGroup.id,
      tabIds: [latestTab.id]
    });
    await setGroupRuleMapping(existingGroup.id, rule.key);
    return;
  }

  const windowTabs = await chrome.tabs.query({
    windowId: latestTab.windowId,
    pinned: false
  });
  const matchingUngroupedIds = windowTabs
    .filter((t) => t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE)
    .filter((t) => matchTabToRule(t, categories)?.key === rule.key)
    .map((t) => t.id);

  if (matchingUngroupedIds.length >= 2) {
    const groupId = await chrome.tabs.group({
      tabIds: matchingUngroupedIds,
      createProperties: { windowId: latestTab.windowId }
    });
    justCreatedGroups.delete(groupId);
    await chrome.tabGroups.update(groupId, {
      title: rule.label,
      color: rule.color
    });
    await setGroupRuleMapping(groupId, rule.key);
  }
}

async function triggerAutoGroup(tabId, windowId, attempt = 0) {
  if (!(await isAutoGroupEnabled())) return;

  let shouldRetry = false;

  await withWindowLock(windowId, async () => {
    try {
      await processAutoGroupTab(tabId);
    } catch (err) {
      if (isDragLockError(err)) {
        shouldRetry = true;
      }
    }
  });

  if (shouldRetry && attempt < 15) {
    clearTimeout(groupRetryTimers.get(tabId));
    const timer = setTimeout(() => {
      groupRetryTimers.delete(tabId);
      triggerAutoGroup(tabId, windowId, attempt + 1).catch((err) =>
        console.error("Auto-group retry failed:", err)
      );
    }, 250);
    groupRetryTimers.set(tabId, timer);
  }
}

chrome.tabGroups.onCreated.addListener((group) => {
  justCreatedGroups.set(group.id, Date.now() + 4000);
});

chrome.tabGroups.onRemoved.addListener(async (group) => {
  justCreatedGroups.delete(group.id);
  try {
    await removeGroupRuleMapping(group.id);
  } catch {
    // Ignore storage cleanup errors
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab) return;

  if (changeInfo.groupId !== undefined) {
    if (changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      await triggerAutoUngroup(tab.windowId);
    } else if (justCreatedGroups.has(changeInfo.groupId)) {
      try {
        const groupTabs = await chrome.tabs.query({
          windowId: tab.windowId,
          groupId: changeInfo.groupId
        });
        if (groupTabs.length >= 2) {
          justCreatedGroups.delete(changeInfo.groupId);
        }
      } catch {
        // Ignore drag-lock errors; ungroupSingleTabGroups also clears >= 2
      }
    }
  }

  if (!changeInfo.url && changeInfo.status !== "complete") return;
  if (tab.pinned || tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;

  await triggerAutoGroup(tabId, tab.windowId);
});

chrome.tabs.onMoved.addListener(async (_tabId, moveInfo) => {
  await triggerAutoUngroup(moveInfo.windowId);
});

chrome.tabs.onRemoved.addListener(async (_tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) return;
  await triggerAutoUngroup(removeInfo.windowId);
});

chrome.tabs.onDetached.addListener(async (_tabId, detachInfo) => {
  await triggerAutoUngroup(detachInfo.oldWindowId);
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    if (!win?.id) return;

    if (command === "clean-up") {
      const res = await runCleanUp(win.id);
      const badge = res.closedTotal > 0 ? `-${res.closedTotal}` : "✓";
      await flashBadge(badge, "#16a34a");
    } else if (command === "merge-windows") {
      const res = await mergeAllWindowsInto(win.id);
      await flashBadge(res.mergedWindows > 0 ? "✓" : "•", "#18181b");
    }
  } catch (err) {
    console.error(`Command "${command}" failed:`, err);
    await flashBadge("!", "#dc2626");
  }
});