import type { OperationFlow, FlowStep } from '../recorder/types';

export interface ExecutionOptions {
  headless?: boolean;
  slowMo?: number;
  timeout?: number;
}

export interface StepResult {
  stepId: string;
  success: boolean;
  error?: string;
  duration: number;
}

export interface ExecutionResult {
  success: boolean;
  error?: string;
  stepResults: StepResult[];
  totalDuration: number;
}

/**
 * Playwright 执行器 - 支持代码生成和页面内执行
 */
export class PlaywrightRunner {
  private options: ExecutionOptions;

  constructor(options: ExecutionOptions = {}) {
    this.options = {
      headless: true,
      slowMo: 500,
      timeout: 30000,
      ...options,
    };
  }

  /**
   * 生成 Playwright 代码
   */
  generateCode(flow: OperationFlow, args: Record<string, string> = {}): string {
    const lines: string[] = [];

    lines.push(`// 🤖 Autopilot Generated: ${flow.name}`);
    if (Object.keys(args).length > 0) {
      lines.push(`// Parameters: ${JSON.stringify(args)}`);
    }
    lines.push('// 1. Run: npm init -y && npm i playwright');
    lines.push('// 2. Run: node run.js');
    lines.push('');
    lines.push('const { chromium } = require("playwright");');
    lines.push('');
    lines.push('(async () => {');
    lines.push('  const browser = await chromium.launch({ headless: false, slowMo: 500 });');
    lines.push('  const page = await browser.newPage();');
    lines.push('');

    flow.steps.forEach((step, i) => {
      lines.push(`  // Step ${i + 1}: ${step.description}`);
      lines.push(this.stepToPlaywrightCode(step, args));
      lines.push('');
    });

    lines.push('  await page.waitForTimeout(2000);');
    lines.push('  await browser.close();');
    lines.push('})();');

    return lines.join('\n');
  }

  private stepToPlaywrightCode(step: FlowStep, args: Record<string, string> = {}): string {
    const selector = step.target?.cssSelector || '';
    let value = step.value || '';
    
    // 替换参数
    for (const [key, val] of Object.entries(args)) {
      value = value.replace(`{{${key}}}`, val);
    }

    switch (step.action) {
      case 'navigate':
        const url = step.target?.attributes?.url || value;
        return url ? `  await page.goto("${url}");` : '  // Navigation step';

      case 'click':
        return `  await page.click("${selector}");`;

      case 'input':
      case 'fill':
      case 'type':
        return `  await page.fill("${selector}", "${value}");`;

      case 'keydown':
        return `  await page.press("${selector}", "${step.key || 'Enter'}");`;

      case 'select':
        return `  await page.selectOption("${selector}", "${value}");`;

      case 'wait':
        return `  await page.waitForSelector("${selector}");`;

      case 'submit':
        return `  await Promise.all([` +
          `\n    page.waitForNavigation(),` +
          `\n    page.click("${selector}")` +
          `\n  ]);`;

      case 'hover':
        return `  await page.hover("${selector}");`;

      case 'scroll':
        return `  await page.evaluate(() => window.scrollTo(${value || '0, 0'}));`;

      default:
        return `  // ${step.description}`;
    }
  }

  /**
   * 🚀 在当前页面中直接执行（使用 DOM API）
   * 无需 Playwright，直接在浏览器中运行
   */
  async executeInPage(
    flow: OperationFlow,
    args: Record<string, string> = {},
    onProgress?: (stepIndex: number, total: number, step: FlowStep, status: 'running' | 'done' | 'error') => void
  ): Promise<ExecutionResult> {
    const stepResults: StepResult[] = [];
    const startTime = Date.now();

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      const stepStart = Date.now();
      
      onProgress?.(i, flow.steps.length, step, 'running');
      
      try {
        // 应用参数替换
        let effectiveStep = step;
        if (Object.keys(args).length > 0 && step.value) {
          let newValue = step.value;
          for (const [key, val] of Object.entries(args)) {
            newValue = newValue.replace(`{{${key}}}`, val);
          }
          effectiveStep = { ...step, value: newValue };
        }
        
        await this.executeStepInPage(effectiveStep);
        const duration = Date.now() - stepStart;
        
        stepResults.push({
          stepId: step.id,
          success: true,
          duration,
        });
        
        onProgress?.(i, flow.steps.length, step, 'done');
        
      } catch (error) {
        const duration = Date.now() - stepStart;
        stepResults.push({
          stepId: step.id,
          success: false,
          error: String(error),
          duration,
        });
        
        stepResults.push({
          stepId: step.id,
          success: false,
          error: String(error),
          duration,
        });
        
        onProgress?.(i, flow.steps.length, step, 'error');
        
        return {
          success: false,
          error: `Step failed: ${step.description} - ${String(error)}`,
          stepResults,
          totalDuration: Date.now() - startTime,
        };
      }

      // 步骤之间的延迟
      if (this.options.slowMo && i < flow.steps.length - 1) {
        await new Promise(resolve => setTimeout(resolve, this.options.slowMo));
      }
    }

    const totalDuration = Date.now() - startTime;
    
    return {
      success: true,
      stepResults,
      totalDuration,
    };
  }

  private async executeStepInPage(step: FlowStep): Promise<void> {
    const selector = step.target?.cssSelector || '';

    switch (step.action) {
      case 'navigate':
        const url = step.target?.attributes?.url || step.value;
        if (url) {
          window.location.href = url;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        break;

      case 'click':
        const clickEl = await this.waitForElement(selector);
        (clickEl as HTMLElement).click();
        await new Promise(resolve => setTimeout(resolve, 500));
        break;

      case 'input':
      case 'fill':
      case 'type':
        const inputEl = await this.waitForElement(selector) as HTMLInputElement;
        inputEl.value = step.value || '';
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 300));
        break;

      case 'select':
        const selectEl = await this.waitForElement(selector) as HTMLSelectElement;
        selectEl.value = step.value || '';
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        break;

      case 'wait':
        if (selector) {
          await this.waitForElement(selector);
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        break;

      case 'submit':
        const submitEl = await this.waitForElement(selector);
        (submitEl as HTMLElement).click();
        await new Promise(resolve => setTimeout(resolve, 1500));
        break;

      case 'hover':
        const hoverEl = await this.waitForElement(selector);
        hoverEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        break;

      case 'scroll':
        if (step.value) {
          const [x, y] = step.value.split(',').map(Number);
          window.scrollTo(x, y);
        }
        break;
    }
  }

  private async waitForElement(selector: string, timeout = 5000): Promise<Element> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timeout waiting for element: ${selector}`);
  }

  /**
   * 导出为 Puppeteer 代码
   */
  generatePuppeteerCode(flow: OperationFlow): string {
    const lines: string[] = [];

    lines.push(`// Autopilot: ${flow.name}`);
    lines.push('const puppeteer = require("puppeteer");');
    lines.push('');
    lines.push('(async () => {');
    lines.push('  const browser = await puppeteer.launch({ headless: false });');
    lines.push('  const page = await browser.newPage();');
    lines.push('');

    flow.steps.forEach((step, i) => {
      lines.push(`  // Step ${i + 1}: ${step.description}`);
      lines.push(this.stepToPuppeteerCode(step));
      lines.push('');
    });

    lines.push('  await page.waitForTimeout(2000);');
    lines.push('  await browser.close();');
    lines.push('})();');

    return lines.join('\n');
  }

  private stepToPuppeteerCode(step: FlowStep): string {
    const selector = step.target?.cssSelector || '';

    switch (step.action) {
      case 'navigate':
        const url = step.target?.attributes?.url || step.value;
        return url ? `  await page.goto("${url}");` : '  // Navigation';

      case 'click':
        return `  await page.click("${selector}");`;

      case 'input':
      case 'fill':
      case 'type':
        return `  await page.type("${selector}", "${step.value || ''}");`;

      case 'select':
        return `  await page.select("${selector}", "${step.value || ''}");`;

      case 'wait':
        return `  await page.waitForSelector("${selector}");`;

      default:
        return `  // ${step.description}`;
    }
  }
}
