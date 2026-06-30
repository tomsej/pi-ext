/**
 * session-store — Full-text search across all pi sessions via SQLite FTS5 + BM25
 *
 * No archiving, no cleanup — purely a search index.
 *
 * Features:
 *   /search            — Interactive FTS search with preview
 *   search_sessions    — LLM tool for querying across sessions
 *   Auto-index on agent_end + catch-up on session_start
 */

import { statSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Text, getMarkdownTheme } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import {
  indexSession,
  searchSessions,
  getIndexedSessionsWithMtime,
  listSessionFiles,
  pruneMissingSessions,
  closeDb,
  getStats,
  isFtsAvailable,
} from "./db.js";
import { SearchOverlay } from "./search-overlay.js";

let initialCatchUpDone = false;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}



/** Index the current session if needed */
function maybeIndexCurrent(ctx: ExtensionContext): void {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) return;

  let stat: { mtimeMs: number };
  try {
    stat = statSync(sessionFile);
  } catch {
    return;
  }

  const indexed = getIndexedSessionsWithMtime();
  const expectedEntries = ctx.sessionManager.getEntries().length;
  const dbRecord = indexed.get(sessionFile);

  if (
    dbRecord === undefined ||
    dbRecord.total_entries !== expectedEntries ||
    dbRecord.file_mtime !== stat.mtimeMs
  ) {
    try {
      indexSession(sessionFile);
    } catch (err) {
      console.error("[session-store] Failed to index current session:", err);
    }
  }
}

/** Catch-up scan: index all sessions not yet in DB */
async function catchUpScan(ctx: ExtensionContext): Promise<void> {
  if (initialCatchUpDone) return;
  initialCatchUpDone = true;

  const files = listSessionFiles();
  if (files.length === 0) return;

  const indexed = getIndexedSessionsWithMtime();
  const existingPaths = new Set(files);
  let newCount = 0;
  let removedCount = 0;
  let errorCount = 0;

  try {
    removedCount = pruneMissingSessions(existingPaths);
  } catch (err) {
    errorCount++;
    console.error("[session-store] Failed to prune missing sessions:", err);
  }

  for (const file of files) {
    let stat: { size: number; mtimeMs: number };
    try {
      stat = statSync(file);
    } catch {
      continue;
    }

    const dbRecord = indexed.get(file);
    if (
      dbRecord !== undefined &&
      dbRecord.file_mtime !== null &&
      dbRecord.file_mtime === stat.mtimeMs &&
      dbRecord.total_entries !== undefined
    ) {
      continue;
    }

    try {
      indexSession(file);
      newCount++;
    } catch (err) {
      errorCount++;
      console.error(`[session-store] Failed to index ${file}:`, err);
    }
  }

  if (newCount > 0 || removedCount > 0 || errorCount > 0) {
    const stats = getStats();
    const removed = removedCount > 0 ? `, pruned ${removedCount}` : "";
    const msg = `🔍 Indexed ${newCount} sessions${removed} (${stats.totalSessions} total, ${formatBytes(stats.dbSizeBytes)})`;
    if (ctx.hasUI) {
      ctx.ui.setStatus("session-store", msg);
      setTimeout(() => ctx.ui.setStatus("session-store", undefined), 5000);
    }
  }
}

export default function (pi: ExtensionAPI) {
  // ── /search — Interactive FTS search ──
  pi.registerCommand("search", {
    description: "Search across all indexed sessions via FTS5 + BM25",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!isFtsAvailable()) {
        ctx.ui.notify("FTS5 not available — cannot search", "error");
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify("session-store requires interactive mode", "error");
        return;
      }

      const action = await ctx.ui.custom<
        { type: "select"; path: string } | { type: "close" }
      >(
        (tui, theme, _kb, done) => {
          return new SearchOverlay({
            theme,
            getTermRows: () => tui.terminal?.rows ?? 40,
            getTermCols: () => tui.terminal?.cols ?? 120,
            requestRender: () => tui.requestRender(),
            onDone: done,
            onSearch: (query) => searchSessions(query, 20),
          });
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            width: "90%",
            minWidth: 80,
            maxHeight: "90%",
          },
        },
      );

      if (action.type === "select") {
        // Print the selected session path so user can reference it
        ctx.log(`Selected session: ${action.path}`);
      }
    },
  });

  // ── search_sessions — LLM tool ──
  pi.registerTool({
    name: "search_sessions",
    label: "Search Sessions",
    description:
      "Search across all indexed pi sessions using full-text search (FTS5 + BM25). " +
      "Returns matching sessions ranked by relevance. Use to find sessions related to a " +
      "topic, technology, task, or decision without loading individual session files. " +
      "The results include session path, project directory, and matching text snippets.",
    promptSnippet: "search_sessions — find relevant past sessions by keyword",
    parameters: Type.Object({
      query: Type.String({
        description:
          "Search query. Supports plain keywords (AND by default), exact phrases in quotes, " +
          "and prefix matching (e.g., 'auth middleware').",
      }),
      limit: Type.Optional(
        Type.Number({
          default: 10,
          description: "Maximum number of results to return (default: 10)",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { query, limit = 10 } = params;

      if (!isFtsAvailable()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: FTS5 is not available in this SQLite build.",
            },
          ],
          details: { error: true },
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Searching: "${query}"` }],
        details: { status: "loading", query },
      });

      const results = searchSessions(query, limit);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No sessions found for: "${query}"`,
            },
          ],
          details: { empty: true, query },
        };
      }

      const lines: string[] = [
        `Found ${results.length} session${results.length === 1 ? "" : "s"} for "${query}":`,
        "",
      ];

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const s = r.record;
        const proj = s.cwd ? s.cwd.split("/").pop() || s.cwd : "unknown";
        const msgs = s.user_message_count + s.assistant_message_count;
        const date = new Date(s.last_activity_at).toISOString().slice(0, 10);

        lines.push(`${i + 1}. **${proj}** · ${date} · ${msgs} msgs · rank ${r.rank.toFixed(2)}`);
        lines.push(`   Path: \`${s.path}\``);

        // Show first matching snippet from search_text
        const firstLine = s.search_text.split("\n")[0]?.trim();
        if (firstLine && firstLine.length > 10) {
          const snippet = firstLine.length > 120 ? firstLine.slice(0, 120) + "…" : firstLine;
          lines.push(`   > ${snippet}`);
        }
        lines.push("");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: {
          query,
          resultCount: results.length,
        },
      };
    },

    renderResult(result, _options, theme, _ctx) {
      const container = new Container();
      const firstContent = result.content[0];
      if (firstContent && firstContent.type === "text") {
        const text = firstContent.text;
        const mdTheme = getMarkdownTheme();
        const md = new Markdown(text, 0, 0, mdTheme, {
          color: (text: string) => theme.fg("toolOutput", text),
        });
        container.addChild(md);
      }
      return container;
    },
  });

  // ── session_start — catch-up scan ──
  pi.on("session_start", async (_event, ctx) => {
    try {
      await catchUpScan(ctx);
    } catch (err) {
      console.error("[session-store] Catch-up scan failed:", err);
    }
  });

  // ── agent_end — incremental index of current session ──
  pi.on("agent_end", async (_event, ctx) => {
    try {
      maybeIndexCurrent(ctx);
    } catch (err) {
      console.error("[session-store] Incremental index failed:", err);
    }
  });

  // ── session_shutdown — close DB ──
  pi.on("session_shutdown", async () => {
    closeDb();
    initialCatchUpDone = false;
  });
}
