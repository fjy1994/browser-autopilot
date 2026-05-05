/**
 * Browser Autopilot Background Service Worker - 持续工作流挖掘引擎
 */

// console.log('[Autopilot] ✅ Background service worker started');

// ========== 持续记录配置 ==========
const RECORDING_CONFIG = {
  SESSION_TIMEOUT: 5 * 60 * 1000,  // 5分钟无操作自动保存会话
  MAX_SESSION_OPS: 200,            // 单会话最多操作数
  MAX_SAVED_SESSIONS: 50,          // 最多保存会话数
  IDLE_CHECK_INTERVAL: 30 * 1000,  // 30秒检查一次空闲状态
};

let currentOperations = [];
let isRecording = true;
let lastActivityTime = Date.now();
let sessionStartTime = Date.now();
let currentSessionId = `session_auto_${Date.now()}`;

// 📡 监听页面导航事件（记录用户访问了什么网站）
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (details.url.includes('chrome-extension://')) return;

  if (isRecording) {
    const navOperation = {
      id: `nav_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: 'navigate',
      timestamp: Date.now(),
      url: details.url,
      title: '',
      fromUrl: '',
      toUrl: details.url,
      isBrowserNavigation: true,
    };
    currentOperations.push(navOperation);
  }
});

// 📡 监听标签页创建
chrome.tabs.onCreated.addListener((tab) => {
  if (isRecording && tab.pendingUrl) {
    currentOperations.push({
      id: `newtab_${Date.now()}`,
      type: 'navigate',
      timestamp: Date.now(),
      url: tab.pendingUrl,
      title: '',
      toUrl: tab.pendingUrl,
      isNewTab: true,
    });
  }
});

// 监听所有消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // console.log('[Background] Got message:', message.type || message.action);

  // content script 发来的操作
  if (message.type === 'RECORD_OPERATIONS') {
    if (isRecording && message.operations) {
      currentOperations.push(...message.operations);
      lastActivityTime = Date.now();
    }
    sendResponse({ status: 'ok', count: currentOperations.length });
    return true;
  }

  // 🚀 执行 Flow（发送给目标页面）
  if (message.action === 'EXECUTE_FLOW') {
    sendResponse({ 
      success: true, 
      status: 'executing',
      message: 'Flow execution started.'
    });
    
    executeFlowOnActiveTab(message.flow, message.args || {})
      .catch(err => console.error('[Background] Flow error:', err));
    
    return true;
  }

  // popup 发来的 action
  switch (message.action) {
    case 'GET_STATE':
      sendResponse({
        isRecording: isRecording,
        operationCount: currentOperations.length,
        sessionCount: 1,
      });
      break;

    case 'TOGGLE_RECORDING':
      isRecording = !isRecording;
      sendResponse({ isRecording });
      break;

    case 'GET_SESSIONS':
      const sessions = [];
      if (currentOperations.length > 0) {
        sessions.push({
          id: 'current_session',
          name: 'Current Recording',
          startTime: Date.now(),
          operations: [...currentOperations],
        });
      }
      sendResponse({ sessions });
      break;

    case 'NEW_SESSION':
      currentOperations = [];
      sendResponse({ sessionId: 'new_' + Date.now() });
      break;

    case 'CLEAR_ALL':
      currentOperations = [];
      sendResponse({ status: 'ok' });
      break;

    default:
      sendResponse({ error: 'unknown action' });
  }

  return true;
});

/**
 * 在当前活动标签页执行 Flow
 */
async function executeFlowOnActiveTab(flow, args = {}) {
  try {
    const targetDomain = extractDomainFromFlow(flow);
    const firstNavUrl = extractFirstUrl(flow);
    let urlToOpen = args.startUrl || firstNavUrl;
    if (!urlToOpen && targetDomain) {
      urlToOpen = `https://${targetDomain}`;
    }
    urlToOpen = urlToOpen || 'https://baidu.com';
    
    const targetTab = await chrome.tabs.create({ url: urlToOpen, active: true });
    await waitForTabReady(targetTab.id);

    let lastError;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const result = await chrome.tabs.sendMessage(targetTab.id, {
          type: 'EXECUTE_FLOW',
          flow,
          args,
        });
        return result;
      } catch (err) {
        lastError = err;
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    
    throw lastError || new Error('Failed to execute after 5 attempts');
  } catch (error) {
    console.error('[Background] ❌ Execute flow failed:', error);
    throw error;
  }
}

async function waitForTabReady(tabId) {
  await new Promise(r => setTimeout(r, 800));
  
  for (let i = 0; i < 20; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      await new Promise(r => setTimeout(r, 300));
      return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  return false;
}

/**
 * 从操作序列中提取第一个 URL
 */
function extractFirstUrl(flow) {
  try {
    const firstOp = flow.steps?.[0] || flow.operations?.[0];
    if (firstOp?.url) return firstOp.url;
    if (firstOp?.target?.attributes?.url) return firstOp.target.attributes.url;
  } catch (e) {}
  return null;
}

/**
 * 从 Flow 中提取域名
 */
function extractDomainFromFlow(flow) {
  try {
    // 优先看第一个导航步骤
    const navStep = flow.steps.find(s => s.action === 'navigate');
    if (navStep?.target?.attributes?.url) {
      const url = new URL(navStep.target.attributes.url);
      return url.hostname.replace('www.', '');
    }

    // 看 Flow 的标签
    if (flow.tags && flow.tags.length > 0) {
      const domainTag = flow.tags.find(t => t.includes('.') && !t.includes(' '));
      if (domainTag) return domainTag;
    }

    // 看 Flow 的名称或描述中有没有域名
    const nameDesc = `${flow.name} ${flow.description}`;
    const domainMatch = nameDesc.match(/([a-z0-9]+\.[a-z]{2,})/i);
    if (domainMatch) return domainMatch[1];

    return null;
  } catch (e) {
    console.error('[Background] Extract domain failed:', e);
    return null;
  }
}

// console.log('[Autopilot] ✅ Message listener ready');

// ========== 🕒 自动会话管理 ==========

async function saveAndStartNewSession() {
  if (currentOperations.length < 3) return;

  const session = {
    id: currentSessionId,
    name: `自动录制 - ${new Date(sessionStartTime).toLocaleString()}`,
    startTime: sessionStartTime,
    endTime: Date.now(),
    operations: [...currentOperations],
    isAutoSaved: true,
  };

  try {
    const storage = await chrome.storage.local.get('autoSavedSessions');
    const savedSessions = storage.autoSavedSessions || [];
    savedSessions.push(session);
    if (savedSessions.length > RECORDING_CONFIG.MAX_SAVED_SESSIONS) {
      savedSessions.shift();
    }
    await chrome.storage.local.set({ autoSavedSessions: savedSessions });
  } catch (e) {
    console.error('[Autopilot] Save session failed:', e);
  }

  currentOperations = [];
  sessionStartTime = Date.now();
  currentSessionId = `session_auto_${Date.now()}`;
}

// 空闲检测定时器
setInterval(async () => {
  if (!isRecording) return;
  const timeSinceLastActivity = Date.now() - lastActivityTime;
  if (timeSinceLastActivity > RECORDING_CONFIG.SESSION_TIMEOUT && currentOperations.length > 0) {
    await saveAndStartNewSession();
  }

  // 会话太长自动分割
  if (currentOperations.length > RECORDING_CONFIG.MAX_SESSION_OPS) {
    await saveAndStartNewSession();
  }

}, RECORDING_CONFIG.IDLE_CHECK_INTERVAL);
