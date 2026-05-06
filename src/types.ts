/** 操作事件类型 */
export type OperationType = 
  | "click"
  | "dblclick"
  | "input"
  | "keydown"
  | "scroll"
  | "navigate"
  | "hover"
  | "select";

/** 基础操作事件 */
export interface BaseOperation {
  id: string;
  type: OperationType;
  timestamp: number;
  url: string;
  title: string;
}

/** DOM 元素定位信息 */
export interface DomTarget {
  tagName: string;
  cssSelector: string;
  xpath: string;
  textContent?: string;
  attributes: Record<string, string>;
  boundingClientRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/** 点击操作 */
export interface ClickOperation extends BaseOperation {
  type: "click" | "dblclick";
  target: DomTarget;
  button: number;
  modifiers: {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
  };
}

/** 输入操作 */
export interface InputOperation extends BaseOperation {
  type: "input" | "keydown";
  target: DomTarget;
  value: string;
  key?: string;
}

/** 导航操作 */
export interface NavigateOperation extends BaseOperation {
  type: "navigate";
  fromUrl: string;
  toUrl: string;
}

/** 滚动操作 */
export interface ScrollOperation extends BaseOperation {
  type: "scroll";
  scrollX: number;
  scrollY: number;
}

/** 选择操作 */
export interface SelectOperation extends BaseOperation {
  type: "select";
  target: DomTarget;
  selectedValue: string;
  selectedText: string;
}

export type Operation = 
  | ClickOperation
  | InputOperation
  | NavigateOperation
  | ScrollOperation
  | SelectOperation;

/** 操作会话 */
export interface OperationSession {
  id: string;
  startTime: number;
  endTime?: number;
  operations: Operation[];
  name?: string;
  description?: string;
}

/** 分析后的操作流程 */
export interface OperationFlow {
  id: string;
  name: string;
  description: string;
  steps: FlowStep[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
  qualityScore?: number;    // 质量评分 0-100
  useCount?: number;        // 执行次数
  isAutoMined?: boolean;    // 是否自动挖掘生成
}

export interface FlowStep {
  id: string;
  action: string;
  description: string;
  target?: DomTarget;
  value?: string;
  key?: string;       // 按键值（仅 action === 'keydown' 时有值，如 'Enter'、'Tab'）
  conditions?: string[];
}