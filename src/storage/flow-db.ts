import type { OperationSession, OperationFlow } from '../types';

const DB_NAME = 'AutopilotDB';
const DB_VERSION = 1;

export class FlowDatabase {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 操作会话存储
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('startTime', 'startTime', { unique: false });
        }

        // 流程存储
        if (!db.objectStoreNames.contains('flows')) {
          const flowStore = db.createObjectStore('flows', { keyPath: 'id' });
          flowStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // 设置存储
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
    });
  }

  private ensureDb() {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  // --- 会话操作 ---

  async saveSession(session: OperationSession): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      const request = store.put(session);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSession(id: string): Promise<OperationSession | undefined> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly');
      const store = tx.objectStore('sessions');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllSessions(limit = 20): Promise<OperationSession[]> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly');
      const store = tx.objectStore('sessions');
      const index = store.index('startTime');
      const request = index.openCursor(null, 'prev');
      const sessions: OperationSession[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && sessions.length < limit) {
          sessions.push(cursor.value);
          cursor.continue();
        } else {
          resolve(sessions);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteSession(id: string): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- 流程操作 ---

  async saveFlow(flow: OperationFlow): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('flows', 'readwrite');
      const store = tx.objectStore('flows');
      const request = store.put(flow);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getFlow(id: string): Promise<OperationFlow | undefined> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('flows', 'readonly');
      const store = tx.objectStore('flows');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllFlows(): Promise<OperationFlow[]> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('flows', 'readonly');
      const store = tx.objectStore('flows');
      const index = store.index('createdAt');
      const request = index.openCursor(null, 'prev');
      const flows: OperationFlow[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          flows.push(cursor.value);
          cursor.continue();
        } else {
          resolve(flows);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteFlow(id: string): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('flows', 'readwrite');
      const store = tx.objectStore('flows');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- 设置操作 ---

  async setSetting(key: string, value: any): Promise<void> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const request = store.put({ key, value });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSetting<T = any>(key: string): Promise<T | undefined> {
    const db = this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// 单例实例
export const flowDb = new FlowDatabase();
