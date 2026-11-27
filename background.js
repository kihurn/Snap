import {
  STORAGE_KEYS,
  getCategories,
  matchTabToRule,
  findMatchingGroupInWindow,
  setGroupRuleMapping,
  removeGroupRuleMapping,
  runCleanUp,
  mergeAllWindowsInto
} from "./utils.js";

// Per-window async queue so simultaneous tabs never race and create duplicate groups
const windowLocks = new Map();
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

async function flashBadge(text, color = "#18181b") {
  clearTimeout(badgeTimer);
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
  }, 3000);
}

async function isAutoGroupEnabled() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.AUTO_GROUP);
  return Boolean(data[STORAGE_KEYS.AUTO_GROUP]);
}

// Auto-group newly loaded / navigated tabs when enabled
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  if (!tab || tab.pinned) return;
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;

  if (!(await isAutoGroupEnabled())) return;

  await withWindowLock(tab.windowId, async () => {
    let latestTab;
    try {
      latestTab = await chrome.tabs.get(tabId);
    } catch {
      return; // Tab closed
    }

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

    // No existing group yet: check if at least 1 other ungrouped tab matches the same rule
    const windowTabs = await chrome.tabs.query({
      windowId: latestTab.windowId,
      pinned: false
    });
    const matchingUngroupedIds = windowTabs
      .filter((t) => t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE)
      .filter((t) => {
        const tRule = matchTabToRule(t, categories);
        return tRule && tRule.key === rule.key;
      })
      .map((t) => t.id);

    if (matchingUngroupedIds.length >= 2) {
      const groupId = await chrome.tabs.group({
        tabIds: matchingUngroupedIds,
        createProperties: { windowId: latestTab.windowId }
      });
      await chrome.tabGroups.update(groupId, {
        title: rule.label,
        color: rule.color
      });
      await setGroupRuleMapping(groupId, rule.key);
    }
  });
});

// Clean up remembered group IDs when a group is closed
chrome.tabGroups.onRemoved.addListener(async (group) => {
  await removeGroupRuleMapping(group.id);
});

// Global keyboard shortcuts
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