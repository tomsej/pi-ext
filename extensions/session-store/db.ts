/**
 * Database layer for session-store
 *
 * SQLite + FTS5 for full-text search across all pi sessions.
 * BM25 ranking via FTS5 built-in rank column.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const DB_PATH = `${process.env.HOME}/.pi/agent/session-store.db`;
const SESSIONS_DIR = `${process.env.HOME}/.pi/agent/sessions`;

let _db: DatabaseSync | null = null;
let _ftsAvailable = false;

export interface SessionRecord {
  path: string;
  id: string;
  cwd: string;
  name: string | null;
  created_at: number;
  last_activity_at: number;
  user_message_count: number;
  assistant_message_count: number;
  total_entries: number;
  file_size_bytes: number;
  file_mtime: number;
  indexed_at: number;
  search_text: string;
}

export interface SearchResult {
  record: SessionRecord;
  rank: number;
}

export interface IndexStats {
  totalSessions: number;
  dbSizeBytes: number;
}

export interface IndexedSessionCursor {
  limit?: number;
  offset?: number;
}

/** Get or create database connection */
function getDb(): DatabaseSync {
  if (_db) return _db;

  _db = new DatabaseSync(DB_PATH);
  _db.exec("PRAGMA journal_mode=WAL");

  // Create metadata table
  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      path TEXT PRIMARY KEY,
      id TEXT,
      cwd TEXT,
      name TEXT,
      created_at INTEGER,
      last_activity_at INTEGER,
      user_message_count INTEGER,
      assistant_message_count INTEGER,
      total_entries INTEGER,
      file_size_bytes INTEGER,
      file_mtime INTEGER,
      indexed_at INTEGER,
      search_text TEXT
    )
  `);

  // Migration: add file_mtime if missing (v1 schema didn't have it)
  try {
    _db.prepare("SELECT file_mtime FROM sessions LIMIT 1").get();
  } catch {
    _db.exec("ALTER TABLE sessions ADD COLUMN file_mtime INTEGER");
  }

  // Create FTS5 virtual table for full-text search
  try {
    _db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
        search_text, name, cwd,
        content='sessions',
        content_rowid='rowid'
      )
    `);

    // Trigger: keep FTS in sync on insert
    _db.exec(`
      CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
        INSERT INTO sessions_fts(rowid, search_text, name, cwd)
        VALUES (new.rowid, new.search_text, new.name, new.cwd);
      END
    `);

    // Trigger: keep FTS in sync on delete
    _db.exec(`
      CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
        INSERT INTO sessions_fts(sessions_fts, rowid, search_text, name, cwd)
        VALUES ('delete', old.rowid, old.search_text, old.name, old.cwd);
      END
    `);

    // Existing databases may predate triggers or may have stale FTS rows.
    // Rebuild when counts drift so Telescope/search use the stored index reliably.
    try {
      const sessionCount = (_db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as any)?.count ?? 0;
      const ftsCount = (_db.prepare("SELECT COUNT(*) AS count FROM sessions_fts").get() as any)?.count ?? 0;
      if (sessionCount !== ftsCount) {
        _db.exec("INSERT INTO sessions_fts(sessions_fts) VALUES('rebuild')");
      }
    } catch {
      _db.exec("INSERT INTO sessions_fts(sessions_fts) VALUES('rebuild')");
    }

    _ftsAvailable = true;
  } catch (err) {
    console.error("[session-store] FTS5 not available:", err);
    _ftsAvailable = false;
  }

  return _db;
}

/** Check if FTS5 is available */
export function isFtsAvailable(): boolean {
  getDb();
  return _ftsAvailable;
}

/** Extract text content from a message content field */
function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}

/** Parse a JSONL session file and return record data */
function parseSession(filePath: string): SessionRecord | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const stat = statSync(filePath);
  const lines = raw.split("\n");

  let id = "";
  let cwd = "";
  let name: string | null = null;
  let createdAt = 0;
  let lastActivityAt = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  const texts: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);
      const ts = parseTimestamp(entry.timestamp);

      if (ts > 0) {
        if (createdAt === 0 || ts < createdAt) createdAt = ts;
        if (ts > lastActivityAt) lastActivityAt = ts;
      }

      if (entry.type === "session") {
        id = entry.id || "";
        cwd = entry.cwd || "";
      } else if (entry.type === "session_info" && entry.name) {
        name = entry.name;
      } else if (entry.type === "message" && entry.message) {
        const msg = entry.message;
        if (msg.role === "user" || msg.role === "assistant") {
          const text = extractMessageText(msg.content);
          if (text.trim()) {
            texts.push(text.trim());
            if (msg.role === "user") userMessageCount++;
            else assistantMessageCount++;
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return {
    path: filePath,
    id,
    cwd,
    name,
    created_at: createdAt,
    last_activity_at: lastActivityAt,
    user_message_count: userMessageCount,
    assistant_message_count: assistantMessageCount,
    total_entries: lines.filter((l) => l.trim()).length,
    file_size_bytes: stat.size,
    file_mtime: stat.mtimeMs,
    indexed_at: Date.now(),
    search_text: texts.join("\n\n"),
  };
}

function parseTimestamp(ts: unknown): number {
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") return new Date(ts).getTime();
  return 0;
}

/** Index a single session file. Re-indexes if already present. */
export function indexSession(filePath: string): void {
  const db = getDb();
  const record = parseSession(filePath);
  if (!record) return;

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM sessions WHERE path = ?").run(filePath);
    db.prepare(`
      INSERT INTO sessions
      (path, id, cwd, name, created_at, last_activity_at,
       user_message_count, assistant_message_count, total_entries,
       file_size_bytes, file_mtime, indexed_at, search_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.path,
      record.id,
      record.cwd,
      record.name,
      record.created_at,
      record.last_activity_at,
      record.user_message_count,
      record.assistant_message_count,
      record.total_entries,
      record.file_size_bytes,
      record.file_mtime,
      record.indexed_at,
      record.search_text,
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Get all indexed session paths with their total entry counts */
export function getIndexedSessions(): Map<string, number> {
  const db = getDb();
  const rows = db.prepare("SELECT path, total_entries FROM sessions").all() as any[];
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.path, row.total_entries);
  }
  return map;
}

/** List indexed sessions, newest activity first. Used by Telescope for fast browsing. */
export function listIndexedSessions(cursor: IndexedSessionCursor = {}): SessionRecord[] {
  const db = getDb();
  const limit = Math.max(1, Math.min(cursor.limit ?? 5000, 20_000));
  const offset = Math.max(0, cursor.offset ?? 0);
  const rows = db.prepare(`
    SELECT * FROM sessions
    WHERE (user_message_count + assistant_message_count) > 0
    ORDER BY last_activity_at DESC, file_mtime DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as any[];
  return rows.map(rowToRecord);
}

/** Delete missing files from the index so stale deleted sessions do not show up. */
export function pruneMissingSessions(existingPaths?: Set<string>): number {
  const db = getDb();
  const rows = db.prepare("SELECT path FROM sessions").all() as any[];
  let removed = 0;

  db.exec("BEGIN");
  try {
    const stmt = db.prepare("DELETE FROM sessions WHERE path = ?");
    for (const row of rows) {
      const path = row.path as string;
      const exists = existingPaths ? existingPaths.has(path) : existsSync(path);
      if (!exists) {
        stmt.run(path);
        removed++;
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return removed;
}

/** Get all indexed sessions with file mtime for fast catch-up */
export function getIndexedSessionsWithMtime(): Map<string, { total_entries: number; file_mtime: number }> {
  const db = getDb();
  const rows = db.prepare("SELECT path, total_entries, file_mtime FROM sessions").all() as any[];
  const map = new Map<string, { total_entries: number; file_mtime: number }>();
  for (const row of rows) {
    map.set(row.path, { total_entries: row.total_entries, file_mtime: row.file_mtime });
  }
  return map;
}

/** List all session JSONL files on disk */
export function listSessionFiles(): string[] {
  const files: string[] = [];
  try {
    const dirs = readdirSync(SESSIONS_DIR);
    for (const dir of dirs) {
      const dirPath = join(SESSIONS_DIR, dir);
      try {
        const entries = readdirSync(dirPath);
        for (const file of entries) {
          if (file.endsWith(".jsonl")) {
            files.push(join(dirPath, file));
          }
        }
      } catch {
        // Not a directory or unreadable
      }
    }
  } catch {
    // Sessions dir doesn't exist
  }
  return files;
}

/** Search indexed sessions using FTS5 + BM25 ranking */
export function searchSessions(query: string, limit: number = 10): SearchResult[] {
  const db = getDb();
  if (!_ftsAvailable) {
    // Fallback: LIKE search
    const pattern = `%${query.replace(/%/g, "%%")}%`;
    const rows = db.prepare(`
      SELECT * FROM sessions
      WHERE search_text LIKE ? OR name LIKE ? OR cwd LIKE ?
      ORDER BY last_activity_at DESC
      LIMIT ?
    `).all(pattern, pattern, pattern, limit) as any[];
    return rows
      .filter((r) => existsSync(r.path))
      .map((r) => ({ record: rowToRecord(r), rank: 0 }));
  }

  const trimmed = query.trim();
  if (!trimmed) return [];

  // Build FTS5 query with prefix matching on last token
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const ftsTokens = tokens.map((w, i) => {
    const escaped = w.replace(/"/g, '""');
    return i === tokens.length - 1 ? `"${escaped}"*` : `"${escaped}"`;
  });
  const ftsQuery = ftsTokens.join(" AND ");

  try {
    const rows = db.prepare(`
      SELECT s.*, rank
      FROM sessions s
      JOIN sessions_fts fts ON s.rowid = fts.rowid
      WHERE sessions_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as any[];
    return rows
      .filter((r) => existsSync(r.path))
      .map((r) => ({ record: rowToRecord(r), rank: r.rank }));
  } catch {
    // FTS syntax error — fall through to LIKE
    const pattern = `%${trimmed.replace(/%/g, "%%")}%`;
    const rows = db.prepare(`
      SELECT * FROM sessions
      WHERE search_text LIKE ? OR name LIKE ? OR cwd LIKE ?
      ORDER BY last_activity_at DESC
      LIMIT ?
    `).all(pattern, pattern, pattern, limit) as any[];
    return rows
      .filter((r) => existsSync(r.path))
      .map((r) => ({ record: rowToRecord(r), rank: 0 }));
  }
}

/** Get a single session record by path */
export function getSession(path: string): SessionRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM sessions WHERE path = ?").get(path) as any;
  return row ? rowToRecord(row) : null;
}

/** Get database stats */
export function getStats(): IndexStats {
  const db = getDb();
  const countRow = db.prepare("SELECT COUNT(*) as count FROM sessions").get() as any;
  let size = 0;
  try {
    size = statSync(DB_PATH).size;
  } catch {
    // ignore
  }
  return {
    totalSessions: countRow?.count ?? 0,
    dbSizeBytes: size,
  };
}

/** Close database connection */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function rowToRecord(row: any): SessionRecord {
  return {
    path: row.path,
    id: row.id,
    cwd: row.cwd,
    name: row.name ?? null,
    created_at: row.created_at,
    last_activity_at: row.last_activity_at,
    user_message_count: row.user_message_count,
    assistant_message_count: row.assistant_message_count,
    total_entries: row.total_entries,
    file_size_bytes: row.file_size_bytes,
    file_mtime: row.file_mtime ?? 0,
    indexed_at: row.indexed_at,
    search_text: row.search_text,
  };
}
