// Browser Autopilot Background Service Worker
// 会话组设计：多个有关联的 Tab 共享同一个 Session

const DB_NAME = 'AutopilotDB';
const DB_VERSION = 1;

const RECORDING_CONFIG = {
  SAVE_POINT_IDLE: 5 * 60 * 1000,
  SAVE_CHECK_INTERVAL: 30 * 1000,
};

// 会话组：多个相关 Tab 共享一个 session
class SessionGroup {
  constructor(initialTabId, url) {
    this.groupId = `group_${Date.now()}`;
    this.sessionId = `session_${Date.now()}`;
    this.tabIds = new Set([initialTabId]);
    this.startTime = Date.now();
    this.lastActivityTime = Date.now();
    this.operations = [];
    this.initialUrl = url || '';
  }

  addTab(tabId) {
    this.tabIds.add(tabId);
  }

  removeTab(tabId) {
    this.tabIds.delete(tabId);
  }

  getTabCount() {
    return this.tabIds.size;
  }

  addOperations(ops) {
    this.operations.push(...ops);
    this.lastActivityTime = Date.now();
  }

  addNavigation(url) {
    this.operations.push({
      id: `nav_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: 'navigate',
      timestamp: Date.now(),
      url,
      toUrl: url,
    });
    this.lastActivityTime = Date.now();
  }

  hasMeaningfulOperations() {
    return this.operations.some(op =>
      op.type === 'click' ||
      op.type === 'dblclick' ||
      op.type === 'input' ||
      op.type === 'keydown'
    );
  }

  shouldSave() {
    let latestActivity = this.lastActivityTime;
    for (const tabId of this.tabIds) {
      const tabLastActivity = tabActivityMap.get(tabId) || 0;
      if (tabLastActivity > latestActivity) {
        latestActivity = tabLastActivity;
      }
    }
    return Date.now() - latestActivity > RECORDING_CONFIG.SAVE_POINT_IDLE;
  }

  toJSON() {
    return {
      id: this.sessionId,
      name: `${this.getDomain() || 'Session'} - ${new Date(this.startTime).toLocaleString()}`,
      startTime: this.startTime,
      endTime: this.lastActivityTime,
      operations: [...this.operations],
      isAutoSaved: true,
      tabCount: this.tabIds.size,
      tabIds: Array.from(this.tabIds),
    };
  }

  getDomain() {
    try {
      const opWithUrl = this.operations.find(op => op.url);
      if (opWithUrl) {
        return new URL(opWithUrl.url).hostname;
      }
      return null;
    } catch {
      return null;
    }
  }
}

const sessionGroups = new Map();
const tabToGroupMap = new Map();
const tabActivityMap = new Map();
const pendingNewTabSession = new Map();

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
        sessionStore.createIndex('startTime', 'startTime', { unique: false });
      }
      if (!db.objectStoreNames.contains('flows')) {
        const flowStore = db.createObjectStore('flows', { keyPath: 'id' });
        flowStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
  });
}

async function saveSessionToDB(session) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const request = store.put(session);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

function getOrCreateSessionGroup(tabId, url) {
  let groupId = tabToGroupMap.get(tabId);
  if (!groupId || !sessionGroups.has(groupId)) {
    const group = new SessionGroup(tabId, url);
    groupId = group.groupId;
    sessionGroups.set(groupId, group);
    tabToGroupMap.set(tabId, groupId);
  }
  return sessionGroups.get(groupId);
}

function recordOperation(tabId, ops) {
  const group = getOrCreateSessionGroup(tabId);
  group.addOperations(ops);
  tabActivityMap.set(tabId, Date.now());
}

function startNewSessionGroup(tabId, url) {
  const oldGroupId = tabToGroupMap.get(tabId);
  if (oldGroupId) {
    const oldGroup = sessionGroups.get(oldGroupId);
    if (oldGroup) {
      oldGroup.removeTab(tabId);
      if (oldGroup.getTabCount() === 0) {
        sessionGroups.delete(oldGroupId);
      }
    }
  }
  const newGroup = new SessionGroup(tabId, url);
  tabToGroupMap.set(tabId, newGroup.groupId);
  sessionGroups.set(newGroup.groupId, newGroup);
  console.log(`[Autopilot] 手动输入网址，创建新会话组: Tab ${tabId}`);
  tabActivityMap.set(tabId, Date.now());
}

function linkNewTabToParent(newTabId, sourceGroupId) {
  const parentGroup = sessionGroups.get(sourceGroupId);
  if (parentGroup) {
    parentGroup.addTab(newTabId);
    tabToGroupMap.set(newTabId, sourceGroupId);
    tabActivityMap.set(newTabId, Date.now());
    console.log(`[Autopilot] 新建 Tab ${newTabId} 关联到会话组 ${sourceGroupId}`);
  }
}

async function saveSessionGroup(group) {
  if (!group.hasMeaningfulOperations()) {
    console.log(`[Autopilot] 丢弃会话组 ${group.groupId}（无有效操作）`);
    for (const tabId of group.tabIds) {
      tabToGroupMap.delete(tabId);
      tabActivityMap.delete(tabId);
    }
    sessionGroups.delete(group.groupId);
    return false;
  }

  try {
    const sessionData = group.toJSON();
    await saveSessionToDB(sessionData);
    console.log(`[Autopilot] ✅ 已保存会话组: ${group.groupId}, ${group.operations.length} 个操作, 关联 ${group.getTabCount()} 个 Tab`);
    
    for (const tabId of group.tabIds) {
      const newGroup = new SessionGroup(tabId, '');
      tabToGroupMap.set(tabId, newGroup.groupId);
      sessionGroups.set(newGroup.groupId, newGroup);
    }
    
    sessionGroups.delete(group.groupId);
    return true;
  } catch (e) {
    console.error('[Autopilot] 保存失败:', e);
    return false;
  }
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  
  const isManualInput = 
    details.transitionType === 'typed' ||
    details.transitionQualifiers?.includes('from_address_bar') ||
    details.transitionType === 'auto_bookmark';

  if (isManualInput) {
    startNewSessionGroup(details.tabId, details.url);
  }
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (details.url.includes('chrome-extension://')) return;

  if (pendingNewTabSession.has(details.tabId)) {
    const sourceGroupId = pendingNewTabSession.get(details.tabId);
    pendingNewTabSession.delete(details.tabId);
    linkNewTabToParent(details.tabId, sourceGroupId);
    return;
  }

  const groupId = tabToGroupMap.get(details.tabId);
  if (groupId) {
    const group = sessionGroups.get(groupId);
    if (group) {
      group.addNavigation(details.url);
    }
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId !== undefined) {
    const sourceGroupId = tabToGroupMap.get(tab.openerTabId);
    if (sourceGroupId) {
      pendingNewTabSession.set(tab.id, sourceGroupId);
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const groupId = tabToGroupMap.get(tabId);
  if (groupId) {
    const group = sessionGroups.get(groupId);
    if (group) {
      group.removeTab(tabId);
      console.log(`[Autopilot] Tab ${tabId} 从会话组 ${groupId} 移除，剩余 ${group.getTabCount()} 个 Tab`);
      
      if (group.getTabCount() === 0) {
        if (group.hasMeaningfulOperations()) {
          await saveSessionGroup(group);
        } else {
          sessionGroups.delete(groupId);
        }
      }
    }
  }
  
  tabToGroupMap.delete(tabId);
  tabActivityMap.delete(tabId);
  pendingNewTabSession.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RECORD_OPERATIONS') {
    const tabId = sender.tab?.id;
    if (tabId && message.operations) {
      recordOperation(tabId, message.operations);
    }
    sendResponse({ status: 'ok', tabId });
    return true;
  }
  sendResponse({ status: 'ok' });
  return true;
});

async function checkSavePoints() {
  for (const [groupId, group] of sessionGroups.entries()) {
    if (group.shouldSave() && group.operations.length > 0) {
      await saveSessionGroup(group);
    }
  }
}

setInterval(checkSavePoints, RECORDING_CONFIG.SAVE_CHECK_INTERVAL);

async function init() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id !== undefined) {
        getOrCreateSessionGroup(tab.id, tab.url || '');
      }
    }
    console.log(`[Autopilot] ✅ 已为 ${tabs.length} 个 Tab 初始化会话组，Background 就绪`);
  } catch (e) {
    console.error('[Autopilot] 初始化失败:', e);
  }
}

init();
