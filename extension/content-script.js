/**
 * Browser Autopilot Content Script
 */

let operations = [];
let isRecording = true;

function generateId() {
  return 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function reportOperation(op) {
  operations.push(op);
  chrome.runtime.sendMessage({
    type: 'RECORD_OPERATIONS',
    operations: [op],
  }).catch(() => {});
}

let lastClickTime = 0;

document.addEventListener('click', (e) => {
  if (!isRecording) return;
  
  const now = Date.now();
  if (now - lastClickTime < 300) return;
  lastClickTime = now;
  
  const target = e.target;
  const selector = getSelector(target);
  
  const op = {
    id: generateId(),
    type: 'click',
    timestamp: now,
    url: window.location.href,
    title: document.title,
    target: {
      tagName: target.tagName?.toLowerCase() || '',
      cssSelector: selector,
      textContent: target.textContent?.slice(0, 100) || '',
    },
  };
  
  reportOperation(op);
}, true);

let lastInputValue = '';

document.addEventListener('input', (e) => {
  if (!isRecording) return;
  
  const target = e.target;
  const now = Date.now();
  
  if (target.value && target.value.length >= 2) {
    lastInputValue = target.value;
    
    if (window._autopilotInputTimer) {
      clearTimeout(window._autopilotInputTimer);
    }
    
    window._autopilotInputTimer = setTimeout(() => {
      const selector = getSelector(target);
      
      const op = {
        id: generateId(),
        type: 'input',
        timestamp: now,
        url: window.location.href,
        title: document.title,
        target: {
          tagName: target.tagName?.toLowerCase() || '',
          cssSelector: selector,
        },
        value: lastInputValue.slice(0, 200),
      };
      
      reportOperation(op);
    }, 800);
  }
}, true);

document.addEventListener('keydown', (e) => {
  if (!isRecording) return;
  
  if (e.key === 'Enter') {
    const target = e.target;
    
    if (target.value && target.value.length >= 2) {
      const selector = getSelector(target);
      const inputOp = {
        id: generateId(),
        type: 'input',
        timestamp: Date.now() - 1,
        url: window.location.href,
        title: document.title,
        target: {
          tagName: target.tagName?.toLowerCase() || '',
          cssSelector: selector,
        },
        value: target.value,
      };
      
      reportOperation(inputOp);
      
      lastInputValue = '';
      if (window._autopilotInputTimer) {
        clearTimeout(window._autopilotInputTimer);
        window._autopilotInputTimer = null;
      }
    }
    
    const selector = getSelector(target);
    const op = {
      id: generateId(),
      type: 'keydown',
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title,
      target: {
        tagName: target.tagName?.toLowerCase() || '',
        cssSelector: selector,
      },
      key: 'Enter',
    };
    
    reportOperation(op);
  }
}, true);

function getSelector(el) {
  if (!el) return '';
  
  let current = el;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    if (current.id) {
      return '#' + current.id;
    }
    current = current.parentElement;
  }
  
  current = el;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    if (current.getAttribute('name')) {
      return `[name="${current.getAttribute('name')}"]`;
    }
    current = current.parentElement;
  }
  
  if (window.location.href.includes('baidu.com')) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return '#kw';
    }
    if (el.tagName === 'BUTTON' || el.tagName === 'INPUT' && el.type === 'submit') {
      return '#su';
    }
  }
  
  if (el.tagName === 'INPUT') {
    return `input[type="${el.type || 'text'}"]`;
  }
  if (el.tagName === 'BUTTON') {
    return 'button';
  }
  
  let path = [];
  current = el;
  while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 2) {
    path.unshift(current.tagName.toLowerCase());
    current = current.parentElement;
  }
  
  return path.join(' > ');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PING') {
    sendResponse({ pong: true, url: window.location.href, ready: true });
    return true;
  }

  if (msg.type === 'TOGGLE_RECORDING') {
    isRecording = msg.enabled;
    sendResponse({ status: 'ok' });
    return true;
  }

  if (msg.type === 'EXECUTE_FLOW') {
    sendResponse({ success: true, status: 'started' });
    
    setTimeout(() => {
      executeFlow(msg.flow, msg.args || {})
        .catch(err => console.error('[Autopilot] Flow failed:', err));
    }, 100);
    
    return true;
  }

  sendResponse({ status: 'ok' });
  return true;
});

async function executeFlow(flow, args = {}) {
  const stepResults = [];
  const startTime = Date.now();

  for (let i = 0; i < (flow.steps?.length || 0); i++) {
    const step = flow.steps[i];

    try {
      let effectiveStep = { ...step };
      
      if (Object.keys(args).length > 0 && step.action === 'input') {
        if (args.inputValue) {
          effectiveStep.value = args.inputValue;
        } else if (step.value) {
          let newValue = step.value;
          for (const [key, val] of Object.entries(args)) {
            newValue = newValue.replace(`{{${key}}}`, val);
          }
          effectiveStep.value = newValue;
        }
      }

      await executeStep(effectiveStep);
      
      stepResults.push({ stepIndex: i, success: true });
      
      if (i < flow.steps.length - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      stepResults.push({ stepIndex: i, success: false, error: err.message });
    }
  }

  return {
    success: stepResults.every(r => r.success),
    flowId: flow.id,
    flowName: flow.name,
    stepsTotal: flow.steps?.length || 0,
    stepsCompleted: stepResults.filter(r => r.success).length,
    duration: Date.now() - startTime,
    timestamp: Date.now(),
    stepResults,
  };
}

async function executeStep(step) {
  if (!step) throw new Error('Step is undefined');

  const selector = step.target?.cssSelector || step.target;
  if (!selector && step.action !== 'navigate' && step.action !== 'goto') {
    throw new Error(`Step "${step.description}" has no valid selector`);
  }

  switch (step.action) {
    case 'click':
      return await executeClick(selector);
    case 'input':
      return await executeInput(selector, step.value || '');
    case 'keydown':
      return await executeKeydown(step.key);
    case 'navigate': case 'goto':
      return await executeNavigate(step.toUrl || step.url || step.value || '');
    case 'select':
      return await executeSelect(selector, step.value || '');
    default:
      return { ok: true, action: 'skipped', reason: 'Unsupported action' };
  }
}

async function executeClick(selector) {
  // 🔥 对于弹窗、公告、提示框：找不到就跳过，不报错！
  const isPopup = /popup|modal|alert|notice|ann/i.test(selector);
  
  const el = document.querySelector(selector);
  if (!el) {
    if (isPopup) {
      return { ok: true, selector, action: 'click', skipped: true, reason: 'Popup not found - skipped' };
    }
    throw new Error(`Element not found: ${selector}`);
  }
  
  el.click();
  return { ok: true, selector, action: 'click' };
}

async function executeInput(selector, value) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  
  el.focus();
  el.value = value;
  
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  
  return { ok: true, selector, action: 'input', value };
}

async function executeKeydown(key) {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true })
  );
  return { ok: true, action: 'keydown', key };
}

async function executeNavigate(url) {
  if (!url) throw new Error('No URL for navigate step');
  window.location.href = url;
  return { ok: true, action: 'navigate', url };
}

async function executeSelect(selector, value) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  
  return { ok: true, selector, action: 'select', value };
}
