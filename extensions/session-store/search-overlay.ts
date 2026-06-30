/**
 * Search overlay — interactive FTS search across all indexed sessions.
 *
 * ╭── search input ────────────┬── preview ─────────────────────╮
 * │ ▸ session 1                │  session title                 │
 * │   session 2                │  metadata                      │
 * │   session 3                │  ────────────────────────────  │
 * │                            │   USER                         │
 * │                            │  message preview...            │
 * │                            │   AGENT                        │
 * │                            │  response preview...           │
 * ╰─────────────────────────────┴───────────────────────────────╯
 */

import type { Component, Focusable } from "@mariozechner/pi-tui";
import { Input, Markdown, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { SessionRecord, SearchResult } from "./db.js";
import { readFileSync } from "node:fs";

export type SearchAction =
  | { type: "select"; path: string }
  | { type: "close" };

interface SearchOverlayOptions {
  theme: Theme;
  getTermRows: () => number;
  getTermCols: () => number;
  requestRender: () => void;
  onDone: (action: SearchAction) => void;
  onSearch: (query: string) => SearchResult[];
}

function padTo(s: string, w: number): string {
  const vis = visibleWidth(s);
  if (vis >= w) return truncateToWidth(s, w);
  return s + " ".repeat(w - vis);
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 30) return `${Math.floor(days / 30)}mo`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return "now";
}

function projectName(cwd: string): string {
  if (!cwd) return "???";
  const parts = cwd.split("/");
  return parts[parts.length - 1] || parts[parts.length - 2] || cwd;
}

// ── Preview cache ────────────────────────────────────────────────────────────

interface PreviewBlock {
  role: "user" | "assistant";
  text: string;
}

const previewCache = new Map<string, PreviewBlock[]>();

function loadPreview(path: string): PreviewBlock[] {
  const cached = previewCache.get(path);
  if (cached) return cached;

  const blocks: PreviewBlock[] = [];
  try {
    const raw = readFileSync(path, "utf-8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message" || !entry.message) continue;
        const msg = entry.message;
        if (msg.role !== "user" && msg.role !== "assistant") continue;
        const text = extractText(msg.content);
        if (text.trim()) {
          blocks.push({ role: msg.role, text: text.trim() });
        }
      } catch { /* skip */ }
    }
  } catch {
    return [];
  }

  // Keep last N messages for preview
  const result = blocks.length > 30 ? blocks.slice(blocks.length - 30) : blocks;
  previewCache.set(path, result);
  return result;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}

// ── Constants ────────────────────────────────────────────────────────────────

const LEFT_HEADER_LINES = 3;

// ── Main component ───────────────────────────────────────────────────────────

export class SearchOverlay implements Component, Focusable {
  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  private results: SearchResult[] = [];
  private selectedIndex = 0;
  private scrollOffset = 0;
  private searchInput: Input;
  private theme: Theme;
  private mdTheme: any;
  private getTermRows: () => number;
  private getTermCols: () => number;
  private requestRender: () => void;
  private onDone: (action: SearchAction) => void;
  private onSearch: (query: string) => SearchResult[];
  private lastSelectedPath: string | undefined;

  constructor(opts: SearchOverlayOptions) {
    this.theme = opts.theme;
    this.mdTheme = getMarkdownTheme();
    this.getTermRows = opts.getTermRows;
    this.getTermCols = opts.getTermCols;
    this.requestRender = opts.requestRender;
    this.onDone = opts.onDone;
    this.onSearch = opts.onSearch;

    this.searchInput = new Input();
  }

  private doSearch(): void {
    const query = this.searchInput.getValue().trim();
    this.results = query ? this.onSearch(query) : [];
    this.selectedIndex = 0;
    this.scrollOffset = 0;
  }

  handleInput(data: string): void {
    // Escape
    if (data === "\x1b") {
      if (this.searchInput.getValue()) {
        this.searchInput.setValue("");
        this.doSearch();
        this.requestRender();
        return;
      }
      this.onDone({ type: "close" });
      return;
    }

    // Navigation
    if (data === "\x1b[A") { // up
      this.moveSelection(-1);
      this.requestRender();
      return;
    }
    if (data === "\x1b[B") { // down
      this.moveSelection(1);
      this.requestRender();
      return;
    }
    if (data === "\t") {
      this.moveSelection(1);
      this.requestRender();
      return;
    }
    if (data === "\x1b[Z") { // shift+tab
      this.moveSelection(-1);
      this.requestRender();
      return;
    }

    // Actions
    if (data === "\r" || data === "\n") {
      const result = this.results[this.selectedIndex];
      if (result) {
        this.onDone({ type: "select", path: result.record.path });
      }
      return;
    }
    if (data === "\x15") { // ctrl+u
      this.searchInput.setValue("");
      this.doSearch();
      this.requestRender();
      return;
    }

    // Everything else → search input
    this.searchInput.handleInput(data);
    this.doSearch();
    this.requestRender();
  }

  private moveSelection(delta: number): void {
    const len = this.results.length;
    if (len === 0) return;
    this.selectedIndex = Math.max(0, Math.min(len - 1, this.selectedIndex + delta));

    const maxItems = this.getMaxListItems();
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + maxItems) {
      this.scrollOffset = this.selectedIndex - maxItems + 1;
    }
  }

  private getContentHeight(): number {
    const termRows = this.getTermRows();
    return Math.max(10, Math.floor(termRows * 0.80) - 2);
  }

  private getMaxListItems(): number {
    const contentH = this.getContentHeight();
    const available = contentH - LEFT_HEADER_LINES;
    return Math.max(1, Math.floor(available / 2));
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render(width: number): string[] {
    const th = this.theme;
    const innerW = width - 2;
    const leftW = Math.max(30, Math.floor(innerW * 0.40));
    const rightW = innerW - leftW - 1;

    const targetH = this.getContentHeight();

    // Left panel: search + results
    const leftLines = this.renderLeftPanel(leftW, targetH);

    // Right panel: preview
    const selected = this.results[this.selectedIndex];
    const rightLines = selected
      ? this.buildPreview(selected.record, rightW, targetH)
      : this.centeredMessage(th.fg("dim", "(no session selected)"), rightW, targetH);

    // Assemble framed output
    const lines: string[] = [];
    const sep = th.fg("border", "│");

    // Top border
    lines.push(th.fg("border", "╭" + "─".repeat(leftW) + "┬" + "─".repeat(rightW) + "╮"));

    // Content rows
    for (let i = 0; i < targetH; i++) {
      lines.push(
        sep + padTo(leftLines[i] ?? "", leftW) + sep + padTo(rightLines[i] ?? "", rightW) + sep,
      );
    }

    // Bottom border with hints
    const footer = " " +
      th.fg("dim", "↑↓") + " " + th.fg("muted", "nav") + "  " +
      th.fg("dim", "⏎") + " " + th.fg("muted", "select") + "  " +
      th.fg("dim", "^U") + " " + th.fg("muted", "clear") + "  " +
      th.fg("dim", "esc") + " " + th.fg("muted", "close");

    lines.push(
      th.fg("border", "╰") + padTo(footer, leftW + 1 + rightW) + th.fg("border", "╯"),
    );

    return lines;
  }

  // ── Left panel ─────────────────────────────────────────────────────────────

  private renderLeftPanel(w: number, totalH: number): string[] {
    const th = this.theme;
    const lines: string[] = [];

    // Title + count
    const title = th.bold(th.fg("accent", " 🔍 Search"));
    const count = th.fg("dim", ` (${this.results.length})`);
    lines.push(title + count);

    // Search input
    const inputLines = this.searchInput.render(w - 5);
    lines.push(" " + th.fg("accent", "🔎") + " " + (inputLines[0] ?? ""));

    // Separator
    lines.push(th.fg("border", " " + "─".repeat(Math.max(1, w - 2))));

    // Results list
    const results = this.results;
    const maxItems = this.getMaxListItems();

    if (results.length === 0) {
      const msg = this.searchInput.getValue() ? "(no matches)" : "(type to search)";
      lines.push("");
      lines.push(th.fg("dim", "  " + msg));
    } else {
      const end = Math.min(results.length, this.scrollOffset + maxItems);
      for (let i = this.scrollOffset; i < end; i++) {
        const r = results[i];
        const s = r.record;
        const isSel = i === this.selectedIndex;

        const name = s.name || s.search_text.split("\n")[0]?.trim() || "(unnamed)";
        const time = relativeTime(s.last_activity_at);
        const msgs = `${s.user_message_count + s.assistant_message_count}msg`;
        const proj = projectName(s.cwd);

        // Line 1: cursor + name + time
        let primary: string;
        if (isSel) {
          primary = th.fg("accent", " ▸ ") + th.bold(truncateToWidth(name, w - 12)) + " " + th.fg("dim", time);
        } else {
          primary = "   " + th.fg("muted", truncateToWidth(name, w - 12)) + " " + th.fg("dim", time);
        }
        lines.push(truncateToWidth(primary, w));

        // Line 2: project + metadata
        const meta = `   ${th.fg("dim", proj)} · ${th.fg("dim", msgs)}`;
        lines.push(truncateToWidth(meta, w));
      }

      if (results.length > maxItems) {
        lines.push(th.fg("dim", `  ${this.scrollOffset + 1}–${end} of ${results.length}`));
      }
    }

    while (lines.length < totalH) lines.push("");
    return lines.slice(0, totalH);
  }

  // ── Right panel: preview ───────────────────────────────────────────────────

  private buildPreview(session: SessionRecord, w: number, h: number): string[] {
    const th = this.theme;
    const lines: string[] = [];

    if (session.path !== this.lastSelectedPath) {
      this.lastSelectedPath = session.path;
    }

    // Header
    const name = session.name || session.search_text.split("\n")[0]?.trim() || "(unnamed)";
    lines.push(truncateToWidth(" " + th.bold(th.fg("accent", name)), w));

    const msgs = `${session.user_message_count + session.assistant_message_count} msgs`;
    const time = relativeTime(session.last_activity_at);
    const cwd = session.cwd || "";
    lines.push(truncateToWidth(" " + th.fg("dim", `${msgs} · ${time} · ${cwd}`), w));
    lines.push(th.fg("border", " " + "─".repeat(Math.max(0, w - 2))));

    // Conversation preview
    const blocks = loadPreview(session.path);
    const headerH = lines.length;
    const contentH = h - headerH;

    if (blocks.length === 0 || contentH <= 0) {
      const emptyLines = this.centeredMessage(th.fg("dim", "(no preview)"), w, Math.max(0, contentH));
      lines.push(...emptyLines);
      while (lines.length < h) lines.push("");
      return lines.slice(0, h);
    }

    const allContentLines: string[] = [];
    let lastRole: string | undefined;

    for (const block of blocks) {
      if (allContentLines.length > 0) allContentLines.push("");

      if (block.role === "user") {
        const pill = th.bold(th.inverse(th.fg("accent", " USER ")));
        allContentLines.push(" " + pill);

        const bgBlank = th.bg("userMessageBg", " ".repeat(w));
        allContentLines.push(bgBlank);

        const md = new Markdown(block.text, 1, 0, this.mdTheme, {
          bgColor: (text: string) => th.bg("userMessageBg", text),
          color: (text: string) => th.fg("userMessageText", text),
        });
        for (const line of md.render(w)) {
          allContentLines.push(th.bg("userMessageBg", padTo(line, w)));
        }
        allContentLines.push(bgBlank);
      } else {
        if (lastRole !== "assistant") {
          const pill = th.bold(th.inverse(th.fg("success", " AGENT ")));
          allContentLines.push(" " + pill);
        }

        const md = new Markdown(block.text, 1, 0, this.mdTheme);
        allContentLines.push(...md.render(w));
      }

      lastRole = block.role;
    }

    for (let i = 0; i < contentH; i++) {
      if (i < allContentLines.length) {
        lines.push(truncateToWidth(allContentLines[i], w));
      } else {
        lines.push("");
      }
    }

    return lines.slice(0, h);
  }

  private centeredMessage(msg: string, w: number, h: number): string[] {
    if (h <= 0) return [];
    const mid = Math.floor(h / 2);
    const vis = visibleWidth(msg);
    const padLeft = Math.max(0, Math.floor((w - vis) / 2));
    return Array.from({ length: h }, (_, i) => (i === mid ? " ".repeat(padLeft) + msg : ""));
  }

  invalidate(): void {}

  dispose(): void {
    previewCache.clear();
  }
}
