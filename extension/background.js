// Browser Autopilot Background Service Worker
// 会话组设计：多个有关联的 Tab 共享同一个 Session

// 🚀 核心执行函数：在页面上真实执行操作
// 这个函数会被序列化后注入到目标页面执行
function executeStepInPage(action, selector, value, timeout = 5000) {
  // 工具函数：等待元素出现，最多等待指定的超时时间
  const waitForElement = (sel) => new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      const el = document.querySelector(sel);
      if (el) {
        resolve(el);
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`元素未找到: ${sel}`));
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });

  return (async () => {
    try {
      switch (action) {
        case 'navigate': {
          // 🚀 直接导航，不需要找元素！
          console.log(`📍 导航到: ${value}`);
          if (!value || !value.startsWith('http')) {
            return { success: false, error: `无效的 URL: ${value}` };
          }
          
          // 先告诉后台成功了，再执行跳转（跳转后页面上下文会丢）
          setTimeout(() => {
            window.location.href = value;
          }, 100);
          
          return { success: true };
        }

        case 'click': {
          console.log(`⏳ 等待元素出现，超时: ${timeout}ms, 选择器: ${selector}`);
          const el = await waitForElement(selector);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await new Promise(r => setTimeout(r, 300));
          el.click();
          return { success: true };
        }

        case 'input': {
          console.log(`⏳ 等待元素出现，超时: ${timeout}ms, 选择器: ${selector}`);
          const el = await waitForElement(selector);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await new Promise(r => setTimeout(r, 300));
          el.focus();
          el.value = '';
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true };
        }

        case 'keydown': {
          console.log(`⏳ 等待元素出现，超时: ${timeout}ms, 选择器: ${selector}`);
          const el = await waitForElement(selector);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await new Promise(r => setTimeout(r, 300));
          el.focus();
          
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: true,
          });
          el.dispatchEvent(enterEvent);
          return { success: true };
        }

        default:
          return { success: false, error: `不支持的操作类型: ${action}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  })();
}

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

// 🔴 全局录制状态 - 用于 popup 控制面板
let isRecording = true;

// 🚫 执行模式标记 - 存储正在执行自动化步骤的标签页ID，这些标签页的操作不记录到session
const executingTabIds = new Set();

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
  // 🔧 关键：如果标签页正在执行自动化操作，跳过录制
  if (executingTabIds.has(tabId)) {
    console.log(`🔇 标签页 ${tabId} 处于执行模式，跳过录制操作`);
    return;
  }
  
  // 如果录制开关关闭，也跳过
  if (!isRecording) {
    return;
  }
  
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
  // content-script 发来的操作记录
  if (message.type === 'RECORD_OPERATIONS') {
    const tabId = sender.tab?.id;
    if (tabId && message.operations) {
      recordOperation(tabId, message.operations);
    }
    sendResponse({ status: 'ok', tabId });
    return true;
  }

  // 🚀 执行单个步骤（核心执行引擎）
  if (message.type === 'EXECUTE_STEP') {
    (async () => {
      const { action, selector, value, stepIndex, targetTabId, waitTimeout } = message;
      console.log(`\n▶️ 执行步骤 ${stepIndex + 1}: ${action} - ${selector} = ${value}`);
      console.log(`⏱️ 元素等待超时: ${waitTimeout || 5000}ms`);
      console.log(`📍 指定的目标 Tab ID: ${targetTabId || '自动选择'}`);

      try {
        let tabToUse = null;
        
        // 🔧 第一步：获取到最终要使用的 tabId 后，标记为执行模式
        // 先获取tabToUse... (后面的逻辑会处理)

        // 1. 如果用户指定了 Tab ID，用这个 Tab
        if (targetTabId) {
          try {
            tabToUse = await new Promise((resolve) => {
              chrome.tabs.get(targetTabId, resolve);
            });
            console.log(`✅ 使用用户指定的标签页: ${tabToUse.url}`);
          } catch (e) {
            console.warn(`⚠️ 指定的标签页 ${targetTabId} 不存在，将新建标签页`);
            tabToUse = null; // 🔧 关键修复：重置为 null，让后续代码正确处理新建标签页逻辑
          }
        }

        // 2. 如果是 navigate，直接开新标签页
        if (action === 'navigate' && !tabToUse) {
          console.log(`🌐 导航操作，打开新标签页: ${value}`);
          const newTab = await new Promise((resolve) => {
            chrome.tabs.create({ url: value, active: true }, resolve);
          });
          tabToUse = newTab;
          
          // 等待页面开始加载再返回，避免后续步骤查不到 URL
          let waited = 0;
          while (waited < 5000 && (!tabToUse.url || tabToUse.status === 'loading')) {
            await new Promise(resolve => setTimeout(resolve, 200));
            waited += 200;
            tabToUse = await new Promise((resolve) => {
              chrome.tabs.get(newTab.id, resolve);
            });
          }
          
          console.log(`✅ 导航操作完成，新标签页 ID: ${tabToUse.id}, URL: ${tabToUse.url}`);
          // 🔧 关键：标记这个新创建的标签页正在执行自动化操作，录制时会跳过
          executingTabIds.add(tabToUse.id);
          console.log(`🔇 新标签页 ${tabToUse.id} 进入执行模式，跳过录制操作`);
          sendResponse({ success: true, tabId: tabToUse.id });
          return;
        }
        
        // 3. 如果是用户指定的 Tab ID，可能还在加载，多等一下
        if (targetTabId && (tabToUse.status === 'loading' || !tabToUse.url)) {
          console.log(`⏳ 等待目标页面加载完成...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          tabToUse = await new Promise((resolve) => {
            chrome.tabs.get(targetTabId, resolve);
          });
        }

        // 3. 如果还没找到 Tab，用当前活动页
        if (!tabToUse) {
          console.log(`🔍 正在查询活动标签页...`);
          const [activeTab] = await new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, resolve);
          });
          tabToUse = activeTab;
        }

        if (!tabToUse || !tabToUse.id) {
          throw new Error('找不到可执行的标签页');
        }

        console.log(`📍 在标签页 ${tabToUse.id} 执行: ${tabToUse.url}`);

        // 🔧 关键：标记这个标签页正在执行自动化操作，录制时会跳过
        executingTabIds.add(tabToUse.id);
        console.log(`🔇 标签页 ${tabToUse.id} 进入执行模式，跳过录制操作`);

        // 检查标签页的 URL 是不是 Chrome 内部页面（不能注入脚本）
        // 如果是我们已知的 targetTabId，跳过检查（信任之前创建的目标页面）
        if (!targetTabId) {
          const isInternalPage = !tabToUse.url || 
            tabToUse.url.startsWith('chrome://') || 
            tabToUse.url.startsWith('chrome-extension://') || 
            tabToUse.url.startsWith('edge://');
            
          if (isInternalPage) {
            const err = new Error(`请先点击"▶️ 执行"按钮，让脚本在新标签页中打开目标网站，再执行后续操作。`);
            console.error(`❌ ${err.message}`);
            sendResponse({ success: false, error: err.message });
            return;
          }
        }
        
        // 页面还在加载中，简单等一下
        if (tabToUse.status === 'loading' || !tabToUse.url) {
          console.log(`⏳ 页面正在加载中，等待...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // 📌 非 navigate 操作：在目标标签页注入脚本执行
        console.log(`🔧 正在注入执行脚本到标签页 ${tabToUse.id}...`);
        const result = await chrome.scripting.executeScript({
          target: { tabId: tabToUse.id },
          func: executeStepInPage,
          args: [action, selector, value, waitTimeout || 5000],
        });

        console.log(`📨 执行脚本返回结果:`, JSON.stringify(result));

        if (!result || !result[0] || !result[0].result) {
          throw new Error('执行脚本未返回有效结果');
        }

        const { success, error } = result[0].result;

        if (success) {
          console.log(`✅ 步骤执行成功`);
          sendResponse({ success: true, tabId: tabToUse.id });
        } else {
          console.error(`❌ 步骤执行失败:`, error);
          sendResponse({ success: false, error: error || '未知错误', tabId: tabToUse.id });
        }

      } catch (error) {
        console.error(`❌ 执行引擎错误:`, error);
        console.error(`❌ 错误堆栈:`, error.stack);
        sendResponse({ success: false, error: error.message || '执行失败' });
      }
    })();
    return true;
  }

  // 📋 获取当前所有标签页，供用户选择执行目标
  if (message.type === 'GET_TABS') {
    (async () => {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ currentWindow: true }, resolve);
      });
      
      const tabList = tabs
        .filter((tab) => tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://'))
        .map((tab) => ({
          id: tab.id,
          title: tab.title || tab.url,
          url: tab.url,
          active: tab.active,
        }));
      
      sendResponse({ tabs: tabList });
    })();
    return true;
  }

  // 📸 捕获当前页面截图（用于失败分析）
  if (message.type === 'CAPTURE_SCREENSHOT') {
    (async () => {
      try {
        const tabId = message.tabId;
        
        // 截图（只截取可视区域）
        const dataUrl = await chrome.tabs.captureVisibleTab(
          chrome.windows.WINDOW_ID_CURRENT,
          { format: 'png', quality: 30 } // 低质量，减少传输大小
        );
        
        // 去掉 data:image/png;base64, 前缀
        const base64Data = dataUrl.split(',')[1];
        
        // 获取当前页面 URL
        const tab = await new Promise((resolve) => {
          chrome.tabs.get(tabId, resolve);
        });
        
        sendResponse({
          success: true,
          screenshot: base64Data,
          pageUrl: tab.url,
        });
      } catch (error) {
        console.error('❌ 截图失败:', error);
        sendResponse({
          success: false,
          error: error.message || '截图失败',
        });
      }
    })();
    return true;
  }

  // ========================================
  // 🎮 Popup 控制面板消息处理
  // ========================================

  // 1️⃣ 获取当前状态
  if (message.action === 'GET_STATE' || message.type === 'GET_STATE') {
    // 计算总操作数
    let operationCount = 0;
    for (const group of sessionGroups.values()) {
      operationCount += group.operations?.length || 0;
    }
    
    sendResponse({
      isRecording,
      operationCount,
    });
    return true;
  }

  // 2️⃣ 切换录制状态
  if (message.action === 'TOGGLE_RECORDING' || message.type === 'TOGGLE_RECORDING') {
    isRecording = !isRecording;
    console.log(`🎙️ 录制状态切换: ${isRecording ? '开始' : '暂停'}`);
    sendResponse({ isRecording });
    return true;
  }

  // 3️⃣ 获取会话列表
  if (message.action === 'GET_SESSIONS' || message.type === 'GET_SESSIONS') {
    (async () => {
      try {
        const db = await openDB();
        const tx = db.transaction('sessions', 'readonly');
        const store = tx.objectStore('sessions');
        const index = store.index('startTime');
        
        // 获取最近的会话
        const request = index.getAll(null, null, 'prev'); // 倒序
        const sessions = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        
        sendResponse({ sessions: sessions.slice(0, message.limit || 10) });
      } catch (e) {
        console.error('获取会话列表失败:', e);
        sendResponse({ sessions: [] });
      }
    })();
    return true;
  }

  // 4️⃣ 新建会话
  if (message.action === 'NEW_SESSION' || message.type === 'NEW_SESSION') {
    (async () => {
      // 保存并关闭当前所有活动的会话组
      for (const group of sessionGroups.values()) {
        await saveSessionGroup(group);
      }
      sessionGroups.clear();
      
      // 为当前所有 Tab 创建新的会话组
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id !== undefined) {
          getOrCreateSessionGroup(tab.id, tab.url || '');
        }
      }
      
      console.log('✅ 已新建会话');
      sendResponse({ success: true });
    })();
    return true;
  }

  // 5️⃣ 清除所有会话
  if (message.action === 'CLEAR_ALL' || message.type === 'CLEAR_ALL') {
    (async () => {
      try {
        const db = await openDB();
        const tx = db.transaction('sessions', 'readwrite');
        const store = tx.objectStore('sessions');
        await new Promise((resolve, reject) => {
          const request = store.clear();
          request.onsuccess = () => resolve(true);
          request.onerror = () => reject(request.error);
        });
        console.log('✅ 已清除所有会话');
        sendResponse({ success: true });
      } catch (e) {
        console.error('清除会话失败:', e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  // 6️⃣ 导出单个会话
  if (message.action === 'EXPORT_SESSION' || message.type === 'EXPORT_SESSION') {
    (async () => {
      try {
        const db = await openDB();
        const tx = db.transaction('sessions', 'readonly');
        const store = tx.objectStore('sessions');
        const request = store.get(message.sessionId);
        const session = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        
        sendResponse({ data: JSON.stringify(session, null, 2) });
      } catch (e) {
        console.error('导出会话失败:', e);
        sendResponse({ data: null, error: e.message });
      }
    })();
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
