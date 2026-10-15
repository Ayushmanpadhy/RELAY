import { DatabaseSync } from 'node:sqlite';

export interface StatementRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface StatementAdapter {
  run(...params: unknown[]): StatementRunResult;
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
}

export interface DatabaseAdapter {
  exec(sql: string): void;
  prepare(sql: string): StatementAdapter;
  transaction<T>(fn: () => T): T;
  close(): void;
}

class NodeSqliteAdapter implements DatabaseAdapter {
  private db: DatabaseSync;
  private inTransaction = false;

  constructor(filename: string = ':memory:') {
    this.db = new DatabaseSync(filename);
    // Enable WAL mode and foreign keys for durability and concurrency
    if (filename !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): StatementAdapter {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => {
        const res = stmt.run(...(params as any[]));
        return {
          changes: Number(res.changes),
          lastInsertRowid: res.lastInsertRowid,
        };
      },
      get: <T = unknown>(...params: unknown[]) => {
        return stmt.get(...(params as any[])) as T | undefined;
      },
      all: <T = unknown>(...params: unknown[]) => {
        return stmt.all(...(params as any[])) as T[];
      },
    };
  }

  transaction<T>(fn: () => T): T {
    if (this.inTransaction) {
      return fn();
    }
    this.inTransaction = true;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const res = fn();
      this.db.exec('COMMIT');
      return res;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }

  close(): void {
    this.db.close();
  }
}

export function createDatabaseAdapter(filename: string = ':memory:'): DatabaseAdapter {
  return new NodeSqliteAdapter(filename);
}
