import type { Operation } from '../types';

/**
 * 工作流挖掘器 - 仅保留使用中的工具方法
 */
export class WorkflowMiner {

  /**
   * 噪音过滤 - 移除无意义操作
   */
  filterNoise(operations: Operation[]): Operation[] {
    if (operations.length === 0) return [];

    const filtered: Operation[] = [];
    const lastTimes = new Map<string, number>();

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];

      // 1. 过滤纯滚动操作
      if (op.type === 'scroll') continue;

      // 2. 过滤快速重复点击（2秒内同一元素多次点击）
      if (op.type === 'click' && op.target?.cssSelector) {
        const lastClick = lastTimes.get(op.target.cssSelector) || 0;
        if (op.timestamp - lastClick < 2000) continue;
        lastTimes.set(op.target.cssSelector, op.timestamp);
      }

      // 3. 过滤空的输入操作
      if (op.type === 'input' && !(op as any).value?.trim()) continue;

      // 4. 过滤重复导航（短时间内重复访问同一页面）
      if (op.type === 'navigate') {
        const prevNavIdx = operations.findIndex((o, idx) =>
          idx < i && o.type === 'navigate' && o.url === op.url
        );
        if (prevNavIdx >= 0) {
          const timeGap = op.timestamp - operations[prevNavIdx].timestamp;
          if (timeGap < 10000) continue;
        }
      }

      filtered.push(op);
    }

    return filtered;
  }

  /**
   * 智能会话分割 - 将长操作序列按时间/域名变化分割
   */
  splitIntoSessions(operations: Operation[]): Operation[][] {
    if (operations.length === 0) return [];

    const sessions: Operation[][] = [];
    let currentSession: Operation[] = [operations[0]];

    for (let i = 1; i < operations.length; i++) {
      const prevOp = operations[i - 1];
      const currOp = operations[i];

      // 分割点 1: 超过 30 秒无操作
      const isLongGap = currOp.timestamp - prevOp.timestamp > 30000;

      // 分割点 2: 域名发生变化
      const prevDomain = this.extractDomain(prevOp.url);
      const currDomain = this.extractDomain(currOp.url);
      const isDomainChanged = prevDomain && currDomain && prevDomain !== currDomain;

      // 分割点 3: 提交操作（Enter）后切换页面
      const isTaskCompletion = prevOp.type === 'keydown' &&
        (prevOp as any).key === 'Enter' &&
        (currOp.type === 'navigate' || isDomainChanged);

      // 分割点 4: 当前会话太长（超过 30 步）
      const isSessionTooLong = currentSession.length >= 30;

      if (isLongGap || isDomainChanged || isTaskCompletion || isSessionTooLong) {
        if (currentSession.length >= 3) {
          sessions.push([...currentSession]);
        }
        currentSession = [currOp];
      } else {
        currentSession.push(currOp);
      }
    }

    // 添加最后一段
    if (currentSession.length >= 3) {
      sessions.push(currentSession);
    }

    // 如果没有有效会话，把所有操作当作一个会话兜底
    return sessions.length > 0 ? sessions : [operations];
  }

  /**
   * 提取域名
   */
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }
}
