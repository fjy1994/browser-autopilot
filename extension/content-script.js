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

function recordClick(e) {
  if (!isRecording) return;
  
  const now = Date.now();
  if (now - lastClickTime < 500) return;  // 延长去重窗口，防止 mousedown + click 重复记录
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
}

// 同时监听 mousedown 和 click（百度等网站用 mousedown 触发跳转）
document.addEventListener('mousedown', recordClick, true);
document.addEventListener('click', recordClick, true);

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
          textContent: target.textContent?.slice(0, 100) || '',
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
          textContent: target.textContent?.slice(0, 100) || '',
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
        textContent: target.textContent?.slice(0, 100) || '',
      },
      value: 'Enter',  // 统一用 value 字段：input 放文本，keydown 放按键名
    };
    
    reportOperation(op);
  }
}, true);

function isUniqueSelector(el, selector) {
  try {
    const elements = document.querySelectorAll(selector);
    return elements.length === 1 && elements[0] === el;
  } catch (e) {
    return false;
  }
}

function getSelector(el) {
  if (!el) return '';
  
  // 1. ID 优先（但要排除动态 ID）
  if (el.id && !el.id.match(/^\d+$/) && !el.id.match(/[A-Z]{2,}\d{3,}/) && !el.id.match(/^id_/)) {
    const selector = '#' + CSS.escape(el.id);
    if (isUniqueSelector(el, selector)) return selector;
  }
  
  // 2. name 属性
  if (el.getAttribute('name')) {
    const selector = `[name="${CSS.escape(el.getAttribute('name'))}"]`;
    if (isUniqueSelector(el, selector)) return selector;
  }
  
  // 3. 测试友好属性
  const testAttrs = ['data-testid', 'data-id', 'data-test', 'id', 'data-cy', 'data-qa'];
  for (const attr of testAttrs) {
    const value = el.getAttribute(attr);
    if (value && !value.includes(' ') && value.length < 50 && !value.match(/^\d+$/)) {
      const selector = `[${attr}="${CSS.escape(value)}"]`;
      if (isUniqueSelector(el, selector)) return selector;
    }
  }
  
  // 4. 有意义的 class（排除动态 class）
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.trim().split(/\s+/).filter(c => 
      c && 
      !c.includes('__') &&  // 排除 CSS Modules
      !c.includes('--') &&  // 排除 CSS 变量
      !c.match(/^[A-Z]/) && // 排除大写开头
      !c.match(/\d{3,}/) && // 排除含长数字
      c.length > 2 && c.length < 30
    );
    for (const cls of classes.slice(0, 3)) {
      const selector = `${el.tagName.toLowerCase()}.${CSS.escape(cls)}`;
      if (isUniqueSelector(el, selector)) return selector;
    }
  }
  
  // 5. 标签 + 文本内容匹配（运行时用，不存选择器）
  // 跳过，文本内容单独记录在 targetText 字段
  
  // 6. 组合父级路径（最多 3 层）
  let path = [];
  let current = el;
  while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 3) {
    let part = current.tagName.toLowerCase();
    
    // 加 nth-child 但只用在同级有重复标签时
    const siblings = Array.from(current.parentElement?.children || []);
    const sameTagSiblings = siblings.filter(s => s.tagName === current.tagName);
    if (sameTagSiblings.length > 1) {
      const index = sameTagSiblings.indexOf(current) + 1;
      part += `:nth-child(${index})`;
    }
    
    path.unshift(part);
    
    // 如果已经能唯一确定了，就不用往上走了
    const tempSelector = path.join(' > ');
    if (isUniqueSelector(el, tempSelector)) {
      return tempSelector;
    }
    
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
