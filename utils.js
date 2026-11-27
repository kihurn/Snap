export const STORAGE_KEYS = {
  AUTO_GROUP: "autoGroup",
  AUTO_UNGROUP_SINGLE: "autoUngroupSingle",
  ACTIVE_AT_END: "activeAtEnd",
  CATEGORIES: "categoryRules",
  GROUP_RULE_MAP: "groupRuleMap",
  SESSIONS: "savedSessions"
};

export const GROUP_COLORS = [
  "blue",
  "cyan",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
  "grey"
];

export const DEFAULT_CATEGORIES = [
  {
    id: "design",
    name: "Design",
    enabled: true,
    color: "pink",
    patterns: ["framer", "figma.com", "dribbble.com", "webflow.com", "behance.net", "canva.com"]
  },
  {
    id: "dev",
    name: "Dev",
    enabled: true,
    color: "blue",
    patterns: [
      "github.com",
      "gitlab.com",
      "stackoverflow.com",
      "localhost",
      "vercel.com",
      "npmjs.com",
      "developer.mozilla.org"
    ]
  },
  {
    id: "ai",
    name: "AI",
    enabled: true,
    color: "purple",
    patterns: ["chatgpt.com", "claude.ai", "gemini.google.com", "perplexity.ai"]
  },
  {
    id: "docs",
    name: "Docs",
    enabled: true,
    color: "cyan",
    patterns: ["docs.google.com", "drive.google.com", "sheets.google.com", "notion.so", "linear.app", "trello.com"]
  },
  {
    id: "media",
    name: "Media",
    enabled: true,
    color: "red",
    patterns: ["youtube.com", "twitch.tv", "spotify.com", "netflix.com"]
  },
  {
    id: "social",
    name: "Social",
    enabled: true,
    color: "orange",
    patterns: ["reddit.com", "x.com", "twitter.com", "linkedin.com", "instagram.com", "threads.net"]
  },
  {
    id: "shopping",
    name: "Shopping",
    enabled: true,
    color: "yellow",
    patterns: ["shopee", "lazada", "amazon."]
  },
  {
    id: "banking",
    name: "Banking",
    enabled: true,
    color: "green",
    patterns: ["maybank", "cimb", "pbebank", "rhb", "hlb"]
  }
];

/* -------------------------------------------
   Settings & Storage Helpers
-------------------------------------------- */
export async function getCategories() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.CATEGORIES);
  if (Array.isArray(data[STORAGE_KEYS.CATEGORIES])) {
    return data[STORAGE_KEYS.CATEGORIES];
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: DEFAULT_CATEGORIES });
  return structuredClone(DEFAULT_CATEGORIES);
}

export async function saveCategories(categories) {
  await chrome.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: categories });
}

export async function getActiveAtEnd() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_AT_END);
  return Boolean(data[STORAGE_KEYS.ACTIVE_AT_END]);
}

export async function getAutoUngroupSingle() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.AUTO_UNGROUP_SINGLE);
  return Boolean(data[STORAGE_KEYS.AUTO_UNGROUP_SINGLE]);
}

export async function ungroupSingleTabGroups(windowId) {
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId })
  ]);
  if (groups.length === 0) return 0;

  const groupedTabs = new Map();
  for (const tab of tabs) {
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      if (!groupedTabs.has(tab.groupId)) groupedTabs.set(tab.groupId, []);
      groupedTabs.get(tab.groupId).push(tab.id);
    }
  }

  const singleTabIds = [];
  for (const tabIds of groupedTabs.values()) {
    if (tabIds.length === 1) {
      singleTabIds.push(tabIds[0]);
    }
  }

  if (singleTabIds.length > 0) {
    await chrome.tabs.ungroup(singleTabIds);
  }
  return singleTabIds.length;
}

export async function getGroupRuleMap() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.GROUP_RULE_MAP);
  return data[STORAGE_KEYS.GROUP_RULE_MAP] || {};
}

export async function setGroupRuleMapping(groupId, ruleKey) {
  const map = await getGroupRuleMap();
  map[String(groupId)] = ruleKey;
  await chrome.storage.local.set({ [STORAGE_KEYS.GROUP_RULE_MAP]: map });
}

export async function removeGroupRuleMapping(groupId) {
  const map = await getGroupRuleMap();
  if (String(groupId) in map) {
    delete map[String(groupId)];
    await chrome.storage.local.set({ [STORAGE_KEYS.GROUP_RULE_MAP]: map });
  }
}

/* -------------------------------------------
   URL, Domain & Category Matching
-------------------------------------------- */
export function isBlankNewTab(tab) {
  const url = (tab.url || tab.pendingUrl || "").trim().toLowerCase();
  return (
    url === "" ||
    url === "about:blank" ||
    url === "about:newtab" ||
    url.startsWith("chrome://newtab") ||
    url.startsWith("chrome://new-tab-page") ||
    url.startsWith("edge://newtab")
  );
}

export function getHttpDomain(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export function getSortableDomain(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.hostname.replace(/^www\./i, "").toLowerCase();
    }
    return url.protocol.replace(":", "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Collapse subdomains (e.g. docs.example.com -> example.com) for base-domain grouping.
 * Keeps common multi-part ccTLDs like .com.my / .co.uk intact.
 */
export function getBaseDomain(hostname) {
  if (!hostname) return null;
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join(".");
  const multiPartSuffixes = new Set(["com.my", "net.my", "org.my", "edu.my", "gov.my", "co.uk", "com.au", "co.jp"]);
  if (multiPartSuffixes.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

export function colorForLabel(label) {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

function matchesPattern(pattern, hostname, fullUrlLower, titleLower) {
  const kw = pattern.trim().toLowerCase();
  if (kw.length < 2) return false;

  // Domain-like pattern (contains a dot, e.g. "x.com", "figma.com", "amazon.")
  if (kw.includes(".") && !kw.includes("/")) {
    if (kw.endsWith(".")) {
      return hostname.startsWith(kw) || hostname.includes("." + kw);
    }
    return hostname === kw || hostname.endsWith("." + kw);
  }

  // Path or general keyword (e.g. "framer", "maybank", "glyph-trail")
  return (
    hostname.includes(kw) ||
    fullUrlLower.includes(kw) ||
    titleLower.includes(kw)
  );
}

/**
 * Resolves a tab to either a Category rule or a Base-Domain rule.
 * Returns { key, label, color } or null.
 */
export function matchTabToRule(tab, categories) {
  const rawUrl = tab.url || tab.pendingUrl || "";
  if (!rawUrl || isBlankNewTab(tab)) return null;

  let hostname = "";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }

  const fullUrlLower = rawUrl.toLowerCase();
  const titleLower = (tab.title || "").toLowerCase();

  // 1. Check enabled Categories (user rules + built-in categories)
  for (const cat of categories) {
    if (!cat.enabled || !Array.isArray(cat.patterns)) continue;
    for (const pattern of cat.patterns) {
      if (matchesPattern(pattern, hostname, fullUrlLower, titleLower)) {
        return {
          key: `cat:${cat.id}`,
          label: cat.name,
          color: cat.color || colorForLabel(cat.name)
        };
      }
    }
  }

  // 2. Fallback to Base Domain
  const baseDomain = getBaseDomain(hostname);
  if (!baseDomain) return null;

  return {
    key: `dom:${baseDomain}`,
    label: baseDomain,
    color: colorForLabel(baseDomain)
  };
}

/* -------------------------------------------
   Find Existing Group for a Rule
-------------------------------------------- */
export async function findMatchingGroupInWindow(windowId, rule, existingGroups = null) {
  const groups = existingGroups || (await chrome.tabGroups.query({ windowId }));
  const ruleMap = await getGroupRuleMap();

  // 1. Match via remembered groupId -> ruleKey (works even after you rename a group!)
  for (const g of groups) {
    if (ruleMap[String(g.id)] === rule.key) {
      return g;
    }
  }

  // 2. Match via group title (case-insensitive)
  const targetTitle = rule.label.toLowerCase();
  return groups.find((g) => (g.title || "").trim().toLowerCase() === targetTitle) || null;
}

/* -------------------------------------------
   Sort Tabs (Groups First + Active-at-End Option)
-------------------------------------------- */
export function getTabSortKey(tab, mode) {
  if (mode === "domain") {
    const domain = getSortableDomain(tab.url || tab.pendingUrl);
    const title = (tab.title || "").toLowerCase();
    return `${domain}\0${title}`;
  }
  return (tab.title || tab.url || "").toLowerCase();
}

export async function sortWindowTabs(windowId, mode = "domain", activeAtEnd = null) {
  const useActiveAtEnd = activeAtEnd === null ? await getActiveAtEnd() : activeAtEnd;

  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId })
  ]);

  if (tabs.length <= 1) return { sortedCount: 0 };

  const activeTab = tabs.find((t) => t.active) || null;
  const activeGroupId =
    activeTab && !activeTab.pinned ? activeTab.groupId : chrome.tabGroups.TAB_GROUP_ID_NONE;

  // 1. Sort pinned tabs inside the pinned region
  const pinnedTabs = tabs.filter((t) => t.pinned);
  if (pinnedTabs.length > 1) {
    pinnedTabs.sort((a, b) => getTabSortKey(a, mode).localeCompare(getTabSortKey(b, mode)));
    await chrome.tabs.move(
      pinnedTabs.map((t) => t.id),
      { index: 0 }
    );
  }

  // 2. Partition unpinned tabs into groups vs ungrouped tabs
  const unpinnedTabs = tabs.filter((t) => !t.pinned);
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const groupedBuckets = new Map();
  const groupUnits = [];
  const ungroupedTabs = [];

  for (const tab of unpinnedTabs) {
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && groupMap.has(tab.groupId)) {
      if (!groupedBuckets.has(tab.groupId)) {
        const list = [];
        groupedBuckets.set(tab.groupId, list);
        groupUnits.push({ group: groupMap.get(tab.groupId), tabs: list });
      }
      groupedBuckets.get(tab.groupId).push(tab);
    } else {
      ungroupedTabs.push(tab);
    }
  }

  // Sort tabs inside each group and assign group sort key
  for (const unit of groupUnits) {
    unit.tabs.sort((a, b) => getTabSortKey(a, mode).localeCompare(getTabSortKey(b, mode)));
    const titleKey = (unit.group.title || "").trim().toLowerCase();
    unit.sortKey = titleKey || getTabSortKey(unit.tabs[0], mode);
  }

  // Order groups (optionally pushing active group to end of groups)
  let orderedGroups = [];
  if (useActiveAtEnd && activeGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    const regular = groupUnits
      .filter((u) => u.group.id !== activeGroupId)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const activeUnit = groupUnits.find((u) => u.group.id === activeGroupId);
    orderedGroups = activeUnit ? [...regular, activeUnit] : regular;
  } else {
    orderedGroups = [...groupUnits].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }

  // Order ungrouped tabs (optionally pushing active ungrouped tab to the very end)
  let orderedUngrouped = [];
  const activeIsUngrouped =
    useActiveAtEnd &&
    activeTab &&
    !activeTab.pinned &&
    activeTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE;

  if (activeIsUngrouped) {
    orderedUngrouped = ungroupedTabs
      .filter((t) => t.id !== activeTab.id)
      .sort((a, b) => getTabSortKey(a, mode).localeCompare(getTabSortKey(b, mode)));
    orderedUngrouped.push(activeTab);
  } else {
    orderedUngrouped = [...ungroupedTabs].sort((a, b) =>
      getTabSortKey(a, mode).localeCompare(getTabSortKey(b, mode))
    );
  }

  // 3. Place sorted groups first, then sorted ungrouped tabs
  for (const unit of orderedGroups) {
    await chrome.tabGroups.move(unit.group.id, { index: -1 });
    const latestTabs = await chrome.tabs.query({ windowId });
    const startIndex = latestTabs.length - unit.tabs.length;
    await chrome.tabs.move(
      unit.tabs.map((t) => t.id),
      { index: startIndex }
    );
  }

  if (orderedUngrouped.length > 0) {
    await chrome.tabs.move(
      orderedUngrouped.map((t) => t.id),
      { index: -1 }
    );
  }

  return { sortedCount: tabs.length };
}

/* -------------------------------------------
   Group Tabs in Window (Category + Domain)
-------------------------------------------- */
export async function groupWindowTabs(windowId, { sortAfter = true } = {}) {
  const [tabs, existingGroups, categories] = await Promise.all([
    chrome.tabs.query({ windowId, pinned: false }),
    chrome.tabGroups.query({ windowId }),
    getCategories()
  ]);

  const buckets = new Map();
  for (const tab of tabs) {
    const rule = matchTabToRule(tab, categories);
    if (!rule) continue;
    if (!buckets.has(rule.key)) {
      buckets.set(rule.key, { rule, tabs: [] });
    }
    buckets.get(rule.key).tabs.push(tab);
  }

  let groupedCount = 0;
  let newGroups = 0;

  for (const { rule, tabs: matchedTabs } of buckets.values()) {
    const existingGroup = await findMatchingGroupInWindow(windowId, rule, existingGroups);

    if (existingGroup) {
      const toAdd = matchedTabs
        .filter((t) => t.groupId !== existingGroup.id)
        .map((t) => t.id);

      if (toAdd.length > 0) {
        await chrome.tabs.group({ groupId: existingGroup.id, tabIds: toAdd });
        await setGroupRuleMapping(existingGroup.id, rule.key);
        groupedCount += toAdd.length;
      }
    } else if (matchedTabs.length >= 2) {
      // Only create a brand new group if 2+ tabs match
      const tabIds = matchedTabs.map((t) => t.id);
      const groupId = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId }
      });
      await chrome.tabGroups.update(groupId, {
        title: rule.label,
        color: rule.color
      });
      await setGroupRuleMapping(groupId, rule.key);
      existingGroups.push({ id: groupId, title: rule.label });
      groupedCount += tabIds.length;
      newGroups++;
    }
  }

  if (await getAutoUngroupSingle()) {
    await ungroupSingleTabGroups(windowId);
  }

  if (sortAfter) {
    await sortWindowTabs(windowId, "domain");
  }

  if (sortAfter) {
    await sortWindowTabs(windowId, "domain");
  }

  return { groupedCount, newGroups };
}

/* -------------------------------------------
   Duplicate Finder
-------------------------------------------- */
export async function findDuplicateTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const byUrl = new Map();

  for (const tab of tabs) {
    const url = tab.url || tab.pendingUrl;
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(tab);
  }

  const duplicates = [];
  for (const group of byUrl.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.index - b.index;
    });
    duplicates.push(...group.slice(1));
  }
  return duplicates;
}

/* -------------------------------------------
   One-Click Clean Up (New Tabs + Dupes + Group + Sort + Collapse Inactive)
-------------------------------------------- */
export async function runCleanUp(windowId) {
  // 1. Close blank New Tabs (safety: keep 1 if every tab is a blank New Tab)
  const initialTabs = await chrome.tabs.query({ windowId });
  const blankTabs = initialTabs.filter(isBlankNewTab);

  let closedNewTabs = 0;
  if (blankTabs.length > 0) {
    let toClose = blankTabs;
    if (blankTabs.length === initialTabs.length) {
      const keep = blankTabs.find((t) => t.active) || blankTabs[0];
      toClose = blankTabs.filter((t) => t.id !== keep.id);
    }
    if (toClose.length > 0) {
      await chrome.tabs.remove(toClose.map((t) => t.id));
      closedNewTabs = toClose.length;
    }
  }

  // 2. Close duplicate tabs
  const duplicates = await findDuplicateTabs(windowId);
  let closedDuplicates = 0;
  if (duplicates.length > 0) {
    await chrome.tabs.remove(duplicates.map((t) => t.id));
    closedDuplicates = duplicates.length;
  }

  // 3. Group & sort
  const { groupedCount, newGroups } = await groupWindowTabs(windowId, { sortAfter: true });

  // 4. Collapse all groups EXCEPT the active tab's group
  const [afterTabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId })
  ]);
  const activeTab = afterTabs.find((t) => t.active);
  const activeGroupId =
    activeTab && !activeTab.pinned ? activeTab.groupId : chrome.tabGroups.TAB_GROUP_ID_NONE;

  for (const group of groups) {
    const shouldCollapse = group.id !== activeGroupId;
    await chrome.tabGroups.update(group.id, { collapsed: shouldCollapse });
  }

  return {
    closedNewTabs,
    closedDuplicates,
    groupedCount,
    newGroups,
    closedTotal: closedNewTabs + closedDuplicates
  };
}

/* -------------------------------------------
   Merge Windows (Manual Button & Shortcut)
-------------------------------------------- */
export async function moveWindowContents(sourceWindowId, targetWindowId) {
  if (sourceWindowId === targetWindowId) return { movedTabs: 0, movedGroups: 0 };

  const sourceTabs = await chrome.tabs.query({ windowId: sourceWindowId });
  if (sourceTabs.length === 0) return { movedTabs: 0, movedGroups: 0 };

  const pinnedIds = new Set(sourceTabs.filter((t) => t.pinned).map((t) => t.id));
  const groups = await chrome.tabGroups.query({ windowId: sourceWindowId });

  let movedGroups = 0;
  for (const group of groups) {
    try {
      await chrome.tabGroups.move(group.id, { windowId: targetWindowId, index: -1 });
      movedGroups++;
    } catch {
      // Ignore special/unmovable groups
    }
  }

  const remainingTabs = await chrome.tabs.query({ windowId: sourceWindowId });
  const ungroupedIds = remainingTabs
    .filter((t) => t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE)
    .map((t) => t.id);

  if (ungroupedIds.length > 0) {
    await chrome.tabs.move(ungroupedIds, { windowId: targetWindowId, index: -1 });
  }

  for (const tabId of pinnedIds) {
    try {
      await chrome.tabs.update(tabId, { pinned: true });
    } catch {
      // Ignore closed tab
    }
  }

  return { movedTabs: sourceTabs.length, movedGroups };
}

export async function mergeAllWindowsInto(targetWindowId) {
  const targetWindow = await chrome.windows.get(targetWindowId);
  if (!targetWindow || targetWindow.type !== "normal") {
    throw new Error("Target window is not a normal browser window.");
  }

  const allWindows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const otherWindows = allWindows.filter(
    (w) => w.id !== targetWindowId && w.incognito === targetWindow.incognito
  );

  if (otherWindows.length === 0) {
    return { mergedWindows: 0, movedTabs: 0 };
  }

  let totalTabsMoved = 0;
  let mergedWindows = 0;

  for (const win of otherWindows) {
    const { movedTabs } = await moveWindowContents(win.id, targetWindowId);
    totalTabsMoved += movedTabs;
    mergedWindows++;
  }

  await chrome.windows.update(targetWindowId, { focused: true });
  return { mergedWindows, movedTabs: totalTabsMoved };
}