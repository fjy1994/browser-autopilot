/**
 * Popup 控制面板逻辑
 */

let state = {
  isRecording: true,
  sessions: [],
  operationCount: 0,
};

// DOM 元素
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const toggleBtn = document.getElementById('toggleBtn');
const newBtn = document.getElementById('newBtn');
const sessionsList = document.getElementById('sessionsList');
const dashboardBtn = document.getElementById('dashboardBtn');
const clearBtn = document.getElementById('clearBtn');
const sessionCountEl = document.getElementById('sessionCount');
const todayOpsEl = document.getElementById('todayOps');

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

// 格式化持续时间
function formatDuration(start, end) {
  if (!end) end = Date.now();
  const duration = end - start;
  if (duration < 60000) return `${Math.floor(duration / 1000)}s`;
  return `${Math.floor(duration / 60000)}m`;
}

// 更新 UI 状态
function updateUI() {
  if (state.isRecording) {
    statusDot.classList.add('recording');
    statusText.textContent = 'Recording...';
    toggleBtn.textContent = '⏹ Stop';
  } else {
    statusDot.classList.remove('recording');
    statusText.textContent = 'Paused';
    toggleBtn.textContent = '▶ Start';
  }
  
  sessionCountEl.textContent = state.sessions.length;
  todayOpsEl.textContent = state.operationCount || 0;
}

// 渲染会话列表
function renderSessions() {
  if (state.sessions.length === 0) {
    sessionsList.innerHTML = '<div class="empty">No sessions yet</div>';
    return;
  }
  
  const html = state.sessions.slice(0, 5).map(session => `
    <div class="session-item" data-session-id="${session.id}">
      <div class="session-header">
        <span class="session-name">${session.name || 'Unnamed'}</span>
        <span class="session-count">${session.operations?.length || 0} ops</span>
      </div>
      <div class="session-time">
        ${formatTime(session.startTime)} · ${formatDuration(session.startTime, session.endTime)}
      </div>
    </div>
  `).join('');
  
  sessionsList.innerHTML = html;
  
  // 添加点击事件
  document.querySelectorAll('.session-item').forEach(item => {
    item.addEventListener('click', () => {
      const sessionId = item.dataset.sessionId;
      exportSession(sessionId);
    });
  });
}

// 导出会话
async function exportSession(sessionId) {
  const response = await chrome.runtime.sendMessage({
    action: 'EXPORT_SESSION',
    sessionId,
  });
  
  if (response.data) {
    const blob = new Blob([response.data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session_${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// 获取状态
async function loadState() {
  try {
    console.log('[Popup] Loading state...');
    
    const stateResponse = await chrome.runtime.sendMessage({ action: 'GET_STATE' });
    console.log('[Popup] State response:', stateResponse);
    
    state.isRecording = stateResponse.isRecording;
    state.operationCount = stateResponse.operationCount || 0;
    
    const sessionsResponse = await chrome.runtime.sendMessage({ 
      action: 'GET_SESSIONS',
      limit: 10,
    });
    console.log('[Popup] Sessions response:', sessionsResponse);
    
    state.sessions = sessionsResponse.sessions || [];
    
    updateUI();
    renderSessions();
  } catch (e) {
    console.error('[Popup] Load state failed:', e);
    // 如果出错，默认显示录制中（向后兼容）
    state.isRecording = true;
    state.operationCount = 0;
    state.sessions = [];
    updateUI();
    renderSessions();
  }
}

// 事件监听
toggleBtn.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ action: 'TOGGLE_RECORDING' });
  state.isRecording = response.isRecording;
  updateUI();
});

newBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'NEW_SESSION' });
  await loadState();
});

clearBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to delete all sessions?')) {
    await chrome.runtime.sendMessage({ action: 'CLEAR_ALL' });
    await loadState();
  }
});

dashboardBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
});

// 初始化 - 确保 DOM 加载完成后延迟执行
document.addEventListener('DOMContentLoaded', () => {
  // 先显示加载状态
  statusText.textContent = 'Loading...';
  toggleBtn.textContent = '...';
  
  // 延迟执行，给 background 唤醒时间
  setTimeout(loadState, 200);
});
