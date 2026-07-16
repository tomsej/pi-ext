/**
 * Diff renderer — Shiki-powered terminal diff for pi write/edit tools.
 *
 * Based on pi-diff by @heyhuynhgiabuu (https://github.com/buddingnewinsights/pi-diff)
 *
 * Architecture:
 *   1. Syntax-highlight full code blocks via Shiki → ANSI (fg-only codes)
 *   2. Layer diff background colors underneath (composites at cell level)
 *   3. For word-level changes, inject brighter bg at changed char positions
 *   4. Result: syntax fg + diff bg + word emphasis — all three visible together
 */

import { existsSync, readFileSync } from "node:fs";
import { extname, relative } from "node:path";

import { createWriteTool, createEditTool, keyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { codeToANSI } from "@shikijs/cli";
import { pill } from "./pill.js";
import * as Diff from "diff";
import type { BundledLanguage, BundledTheme } from "shiki";

// ---------------------------------------------------------------------------
// Diff Theme System
// ---------------------------------------------------------------------------

interface DiffPreset {
	name: string;
	description: string;
	shikiTheme?: string;
	bgAdd?: string;
	bgDel?: string;
	bgAddHighlight?: string;
	bgDelHighlight?: string;
	bgGutterAdd?: string;
	bgGutterDel?: string;
	bgEmpty?: string;
	fgAdd?: string;
	fgDel?: string;
	fgDim?: string;
	fgLnum?: string;
	fgRule?: string;
	fgStripe?: string;
	fgSafeMuted?: string;
}

interface DiffUserConfig {
	diffTheme?: string;
	diffColors?: Record<string, string>;
}

const DIFF_PRESETS: Record<string, DiffPreset> = {
	default: {
		name: "default",
		description: "Original pi-diff colors — tuned for dark theme bases (~#1e1e2e)",
		bgAdd: "#162620",
		bgDel: "#2d1919",
		bgAddHighlight: "#234b32",
		bgDelHighlight: "#502323",
		bgGutterAdd: "#12201a",
		bgGutterDel: "#261616",
		bgEmpty: "#121212",
		fgDim: "#505050",
		fgLnum: "#646464",
		fgRule: "#323232",
		fgStripe: "#282828",
		fgSafeMuted: "#8b949e",
	},
	midnight: {
		name: "midnight",
		description: "Subtle tints for pure black (#000000) terminal backgrounds",
		bgAdd: "#0d1a12",
		bgDel: "#1a0d0d",
		bgAddHighlight: "#1a3825",
		bgDelHighlight: "#381a1a",
		bgGutterAdd: "#091208",
		bgGutterDel: "#120908",
		bgEmpty: "#080808",
		fgDim: "#404040",
		fgLnum: "#505050",
		fgRule: "#282828",
		fgStripe: "#1e1e1e",
		fgSafeMuted: "#8b949e",
	},
	subtle: {
		name: "subtle",
		description: "Minimal backgrounds — barely-there tints for a clean look",
		bgAdd: "#081008",
		bgDel: "#100808",
		bgAddHighlight: "#122818",
		bgDelHighlight: "#281212",
		bgGutterAdd: "#060c06",
		bgGutterDel: "#0c0606",
		bgEmpty: "#060606",
		fgDim: "#383838",
		fgLnum: "#484848",
		fgRule: "#242424",
		fgStripe: "#181818",
		fgSafeMuted: "#8b949e",
	},
	neon: {
		name: "neon",
		description: "Higher contrast backgrounds for better visibility",
		bgAdd: "#1a3320",
		bgDel: "#331a16",
		bgAddHighlight: "#2d5c3a",
		bgDelHighlight: "#5c2d2d",
		bgGutterAdd: "#142818",
		bgGutterDel: "#28120e",
		bgEmpty: "#141414",
		fgDim: "#606060",
		fgLnum: "#787878",
		fgRule: "#404040",
		fgStripe: "#303030",
		fgSafeMuted: "#9da5ae",
	},
};

function parseAnsiRgb(ansi: string): { r: number; g: number; b: number } | null {
	const esc = "\u001b";
	const m = ansi.match(new RegExp(`${esc}\\[(?:38|48);2;(\\d+);(\\d+);(\\d+)m`));
	return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}

function hexToBgAnsi(hex: string): string {
	if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return "";
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `\x1b[48;2;${r};${g};${b}m`;
}

function hexToFgAnsi(hex: string): string {
	if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return "";
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `\x1b[38;2;${r};${g};${b}m`;
}

function deriveBgFromFg(fgAnsi: string, intensity: number): string {
	const rgb = parseAnsiRgb(fgAnsi);
	if (!rgb) return "";
	const r = Math.round(rgb.r * intensity);
	const g = Math.round(rgb.g * intensity);
	const b = Math.round(rgb.b * intensity);
	return `\x1b[48;2;${r};${g};${b}m`;
}

function mixBg(
	base: { r: number; g: number; b: number },
	accent: { r: number; g: number; b: number },
	intensity: number,
): string {
	const r = Math.round(base.r + (accent.r - base.r) * intensity);
	const g = Math.round(base.g + (accent.g - base.g) * intensity);
	const b = Math.round(base.b + (accent.b - base.b) * intensity);
	return `\x1b[48;2;${r};${g};${b}m`;
}

let _autoDerivePending = true;
let _hasExplicitBgConfig = false;

function autoDeriveBgFromTheme(theme: any): void {
	if (!theme?.getFgAnsi) return;
	try {
		const fgAdd = theme.getFgAnsi("toolDiffAdded");
		const fgDel = theme.getFgAnsi("toolDiffRemoved");
		const addRgb = parseAnsiRgb(fgAdd);
		const delRgb = parseAnsiRgb(fgDel);
		if (!addRgb || !delRgb) return;

		let base = { r: 0, g: 0, b: 0 };
		if (theme.getBgAnsi) {
			try {
				const bgAnsi = theme.getBgAnsi("toolSuccessBg");
				const parsed = parseAnsiRgb(bgAnsi);
				if (parsed) {
					base = parsed;
					BG_BASE = bgAnsi;
				}
			} catch {
				/* no toolSuccessBg — use black */
			}
		}

		BG_ADD = mixBg(base, addRgb, 0.08);
		BG_DEL = mixBg(base, delRgb, 0.1);
		BG_ADD_W = mixBg(base, addRgb, 0.2);
		BG_DEL_W = mixBg(base, delRgb, 0.22);
		BG_GUTTER_ADD = mixBg(base, addRgb, 0.05);
		BG_GUTTER_DEL = mixBg(base, delRgb, 0.06);
		BG_EMPTY = BG_BASE;
		RST = `\x1b[0m${BG_BASE}`;
		DIVIDER = `${FG_RULE}│${RST}`;
	} catch {
		// Fall back to defaults silently
	}
}

function loadDiffConfig(): DiffUserConfig {
	const paths = [`${process.cwd()}/.pi/settings.json`, `${process.env.HOME ?? ""}/.pi/settings.json`];
	for (const p of paths) {
		try {
			if (existsSync(p)) {
				const raw = JSON.parse(readFileSync(p, "utf-8"));
				if (raw.diffTheme || raw.diffColors) {
					return { diffTheme: raw.diffTheme, diffColors: raw.diffColors };
				}
			}
		} catch {
			// skip invalid files
		}
	}
	return {};
}

function applyDiffPalette(): void {
	const config = loadDiffConfig();
	const preset = config.diffTheme ? DIFF_PRESETS[config.diffTheme] : null;
	if (preset) _hasExplicitBgConfig = true;

	const ov = config.diffColors ?? {};
	if (Object.keys(ov).length > 0) _hasExplicitBgConfig = true;

	const applyBg = (envName: string | null, key: string, presetVal: string | undefined, set: (v: string) => void) => {
		if (envName && process.env[envName]) return;
		const hex = ov[key] ?? presetVal;
		if (hex) {
			const a = hexToBgAnsi(hex);
			if (a) set(a);
		}
	};
	const applyFg = (envName: string | null, key: string, presetVal: string | undefined, set: (v: string) => void) => {
		if (envName && process.env[envName]) return;
		const hex = ov[key] ?? presetVal;
		if (hex) {
			const a = hexToFgAnsi(hex);
			if (a) set(a);
		}
	};

	applyBg("DIFF_BG_ADD", "bgAdd", preset?.bgAdd, (v) => { BG_ADD = v; });
	applyBg("DIFF_BG_DEL", "bgDel", preset?.bgDel, (v) => { BG_DEL = v; });
	applyBg("DIFF_BG_ADD_HL", "bgAddHighlight", preset?.bgAddHighlight, (v) => { BG_ADD_W = v; });
	applyBg("DIFF_BG_DEL_HL", "bgDelHighlight", preset?.bgDelHighlight, (v) => { BG_DEL_W = v; });
	applyBg("DIFF_BG_GUTTER_ADD", "bgGutterAdd", preset?.bgGutterAdd, (v) => { BG_GUTTER_ADD = v; });
	applyBg("DIFF_BG_GUTTER_DEL", "bgGutterDel", preset?.bgGutterDel, (v) => { BG_GUTTER_DEL = v; });
	applyBg(null, "bgEmpty", preset?.bgEmpty, (v) => { BG_EMPTY = v; });

	applyFg("DIFF_FG_ADD", "fgAdd", preset?.fgAdd, (v) => { FG_ADD = v; });
	applyFg("DIFF_FG_DEL", "fgDel", preset?.fgDel, (v) => { FG_DEL = v; });
	applyFg(null, "fgDim", preset?.fgDim, (v) => { FG_DIM = v; });
	applyFg(null, "fgLnum", preset?.fgLnum, (v) => { FG_LNUM = v; });
	applyFg(null, "fgRule", preset?.fgRule, (v) => { FG_RULE = v; });
	applyFg(null, "fgStripe", preset?.fgStripe, (v) => { FG_STRIPE = v; });
	applyFg(null, "fgSafeMuted", preset?.fgSafeMuted, (v) => { FG_SAFE_MUTED = v; });

	const shiki = ov.shikiTheme ?? preset?.shikiTheme;
	if (shiki) THEME = shiki as BundledTheme;

	DIVIDER = `${FG_RULE}│${RST}`;
	DEFAULT_DIFF_COLORS = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: FG_DIM };
	_autoDerivePending = !_hasExplicitBgConfig;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

let THEME: BundledTheme = (process.env.DIFF_THEME as BundledTheme | undefined) ?? "github-dark";

function envInt(name: string, fallback: number): number {
	const v = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(v) && v > 0 ? v : fallback;
}

function envFg(name: string, fallback: string): string {
	const hex = process.env[name];
	if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `\x1b[38;2;${r};${g};${b}m`;
}

function envBg(name: string, fallback: string): string {
	const hex = process.env[name];
	if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `\x1b[48;2;${r};${g};${b}m`;
}

const SPLIT_MIN_WIDTH = envInt("DIFF_SPLIT_MIN_WIDTH", 150);
const SPLIT_MIN_CODE_WIDTH = envInt("DIFF_SPLIT_MIN_CODE_WIDTH", 60);
const SPLIT_MAX_WRAP_RATIO = 0.2;
const SPLIT_MAX_WRAP_LINES = 8;

const MAX_TERM_WIDTH = 210;
const DEFAULT_TERM_WIDTH = 200;

const MAX_PREVIEW_LINES = 60;
const MAX_RENDER_LINES = 150;
const MAX_HL_CHARS = 80_000;
const CACHE_LIMIT = 192;

const WORD_DIFF_MIN_SIM = 0.15;

const MAX_WRAP_ROWS_WIDE = 3;
const MAX_WRAP_ROWS_MED = 2;
const MAX_WRAP_ROWS_NARROW = 1;

// ---------------------------------------------------------------------------
// ANSI
// ---------------------------------------------------------------------------

let RST = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

let BG_ADD = envBg("DIFF_BG_ADD", "\x1b[48;2;22;38;32m");
let BG_DEL = envBg("DIFF_BG_DEL", "\x1b[48;2;45;25;25m");
let BG_ADD_W = envBg("DIFF_BG_ADD_HL", "\x1b[48;2;35;75;50m");
let BG_DEL_W = envBg("DIFF_BG_DEL_HL", "\x1b[48;2;80;35;35m");
let BG_GUTTER_ADD = envBg("DIFF_BG_GUTTER_ADD", "\x1b[48;2;18;32;26m");
let BG_GUTTER_DEL = envBg("DIFF_BG_GUTTER_DEL", "\x1b[48;2;38;22;22m");
const BG_GUTTER_CTX = "";
let BG_EMPTY = "\x1b[48;2;18;18;18m";

let FG_ADD = envFg("DIFF_FG_ADD", "\x1b[38;2;100;180;120m");
let FG_DEL = envFg("DIFF_FG_DEL", "\x1b[38;2;200;100;100m");
let FG_DIM = "\x1b[38;2;80;80;80m";
let FG_LNUM = "\x1b[38;2;100;100;100m";
let FG_RULE = "\x1b[38;2;50;50;50m";
let FG_SAFE_MUTED = "\x1b[38;2;139;148;158m";

let FG_STRIPE = "\x1b[38;2;40;40;40m";

const BORDER_BAR = "▌";

function stripes(w: number, _rowOffset: number): string {
	return BG_BASE + FG_STRIPE + "╱".repeat(w) + RST;
}

let DIVIDER = `${FG_RULE}│${RST}`;
const ESC_RE = "\u001b";
const ANSI_RE = new RegExp(`${ESC_RE}\\[[0-9;]*m`, "g");
const ANSI_CAPTURE_RE = new RegExp(`${ESC_RE}\\[([^m]*)m`, "g");
const ANSI_PARAM_CAPTURE_RE = new RegExp(`${ESC_RE}\\[([0-9;]*)m`, "g");
const BG_DEFAULT = "\x1b[49m";
let BG_BASE = BG_DEFAULT;

// ---------------------------------------------------------------------------
// Theme-aware diff colors
// ---------------------------------------------------------------------------

interface DiffColors {
	fgAdd: string;
	fgDel: string;
	fgCtx: string;
}

let DEFAULT_DIFF_COLORS: DiffColors = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: FG_DIM };

function resolveDiffColors(theme?: any): DiffColors {
	if (theme?.getBgAnsi && BG_BASE === BG_DEFAULT) {
		try {
			const bgAnsi = theme.getBgAnsi("toolSuccessBg");
			const parsed = parseAnsiRgb(bgAnsi);
			if (parsed) {
				BG_BASE = bgAnsi;
				RST = `\x1b[0m${BG_BASE}`;
			}
		} catch {
			/* ignore */
		}
	}

	if (_autoDerivePending && theme?.getFgAnsi) {
		autoDeriveBgFromTheme(theme);
		_autoDerivePending = false;
	}

	if (!theme?.getFgAnsi) return DEFAULT_DIFF_COLORS;
	try {
		const fgAdd = theme.getFgAnsi("toolDiffAdded") || FG_ADD;
		const fgDel = theme.getFgAnsi("toolDiffRemoved") || FG_DEL;
		const fgCtx = theme.getFgAnsi("toolDiffContext") || FG_DIM;
		return { fgAdd, fgDel, fgCtx };
	} catch {
		return DEFAULT_DIFF_COLORS;
	}
}

// ---------------------------------------------------------------------------
// Adaptive helpers
// ---------------------------------------------------------------------------

function adaptiveWrapRows(tw?: number): number {
	const w = tw ?? termW();
	if (w >= 180) return MAX_WRAP_ROWS_WIDE;
	if (w >= 120) return MAX_WRAP_ROWS_MED;
	return MAX_WRAP_ROWS_NARROW;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiffLine {
	type: "add" | "del" | "ctx" | "sep";
	oldNum: number | null;
	newNum: number | null;
	content: string;
}

interface ParsedDiff {
	lines: DiffLine[];
	added: number;
	removed: number;
	chars: number;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function strip(s: string): string {
	return s.replace(ANSI_RE, "");
}

function tabs(s: string): string {
	return s.replace(/\t/g, "  ");
}

function termW(): number {
	const raw =
		process.stdout.columns ||
		(process.stderr as any).columns ||
		Number.parseInt(process.env.COLUMNS ?? "", 10) ||
		DEFAULT_TERM_WIDTH;
	return Math.max(80, Math.min(raw - 4, MAX_TERM_WIDTH));
}

function fit(s: string, w: number): string {
	if (w <= 0) return "";
	const plain = strip(s);
	if (plain.length <= w) return s + " ".repeat(w - plain.length);
	const showW = w > 2 ? w - 1 : w;
	let vis = 0,
		i = 0;
	while (i < s.length && vis < showW) {
		if (s[i] === "\x1b") {
			const e = s.indexOf("m", i);
			if (e !== -1) {
				i = e + 1;
				continue;
			}
		}
		vis++;
		i++;
	}
	return w > 2 ? `${s.slice(0, i)}${RST}${FG_DIM}›${RST}` : `${s.slice(0, i)}${RST}`;
}

function ansiState(s: string): string {
	let fg = "",
		bg = "";
	for (const match of s.matchAll(ANSI_CAPTURE_RE)) {
		const p = match[1] ?? "";
		const seq = match[0] ?? "";
		if (p === "0") {
			fg = "";
			bg = "";
		} else if (p === "39") {
			fg = "";
		} else if (p.startsWith("38;")) {
			fg = seq;
		} else if (p.startsWith("48;")) {
			bg = seq;
		}
	}
	return bg + fg;
}

function isLowContrastShikiFg(params: string): boolean {
	if (params === "30" || params === "90") return true;
	if (params === "38;5;0" || params === "38;5;8") return true;
	if (!params.startsWith("38;2;")) return false;
	const parts = params.split(";").map(Number);
	if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n))) return false;
	const [, , r, g, b] = parts;
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return luminance < 72;
}

function normalizeShikiContrast(ansi: string): string {
	return ansi.replace(ANSI_PARAM_CAPTURE_RE, (seq, params: string) =>
		isLowContrastShikiFg(params) ? FG_SAFE_MUTED : seq,
	);
}

function wrapAnsi(s: string, w: number, maxRows = adaptiveWrapRows(), fillBg = ""): string[] {
	if (w <= 0) return [""];
	const plain = strip(s);
	if (plain.length <= w) {
		const pad = w - plain.length;
		return pad > 0 ? [s + fillBg + " ".repeat(pad) + (fillBg ? RST : "")] : [s];
	}

	const rows: string[] = [];
	let row = "",
		vis = 0,
		i = 0;
	let onLastRow = false;
	let effW = w;

	while (i < s.length) {
		if (!onLastRow && rows.length >= maxRows - 1) {
			onLastRow = true;
			effW = w > 2 ? w - 1 : w;
		}

		if (s[i] === "\x1b") {
			const end = s.indexOf("m", i);
			if (end !== -1) {
				row += s.slice(i, end + 1);
				i = end + 1;
				continue;
			}
		}

		if (vis >= effW) {
			if (onLastRow) {
				let hasMore = false;
				for (let j = i; j < s.length; j++) {
					if (s[j] === "\x1b") {
						const e2 = s.indexOf("m", j);
						if (e2 !== -1) {
							j = e2;
							continue;
						}
					}
					hasMore = true;
					break;
				}
				if (hasMore && w > 2) row += `${RST}${FG_DIM}›${RST}`;
				else row += fillBg + " ".repeat(Math.max(0, w - vis)) + RST;
				rows.push(row);
				return rows;
			}
			const state = ansiState(row);
			rows.push(row + RST);
			row = state + fillBg;
			vis = 0;
			if (rows.length >= maxRows - 1) {
				onLastRow = true;
				effW = w > 2 ? w - 1 : w;
			}
		}

		row += s[i];
		vis++;
		i++;
	}

	if (row.length > 0 || rows.length === 0) {
		rows.push(row + fillBg + " ".repeat(Math.max(0, w - vis)) + RST);
	}
	return rows;
}

function lnum(n: number | null, w: number, fg = FG_LNUM): string {
	if (n === null) return " ".repeat(w);
	const v = String(n);
	return `${fg}${" ".repeat(Math.max(0, w - v.length))}${v}${RST}`;
}

function shortPath(cwd: string, home: string, p: string): string {
	if (!p) return "";
	const r = relative(cwd, p);
	if (!r.startsWith("..") && !r.startsWith("/")) return r;
	return p.replace(home, "~");
}

function summarize(a: number, d: number): string {
	const p: string[] = [];
	if (a > 0) p.push(`${FG_ADD}+${a}${RST}`);
	if (d > 0) p.push(`${FG_DEL}-${d}${RST}`);
	return p.length ? p.join(" ") : `${FG_DIM}no changes${RST}`;
}

function rule(w: number): string {
	return `${BG_BASE}${FG_RULE}${"─".repeat(w)}${RST}`;
}

function shouldUseSplit(diff: ParsedDiff, tw: number, maxRows = MAX_PREVIEW_LINES): boolean {
	if (!diff.lines.length) return false;
	if (tw < SPLIT_MIN_WIDTH) return false;

	const nw = Math.max(2, String(Math.max(...diff.lines.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const half = Math.floor((tw - 1) / 2);
	const gw = nw + 5;
	const cw = Math.max(12, half - gw);
	if (cw < SPLIT_MIN_CODE_WIDTH) return false;

	const vis = diff.lines.slice(0, maxRows);
	let contentLines = 0;
	let wrapCandidates = 0;
	for (const l of vis) {
		if (l.type === "sep") continue;
		contentLines++;
		if (tabs(l.content).length > cw) wrapCandidates++;
	}
	if (contentLines === 0) return true;

	const wrapRatio = wrapCandidates / contentLines;
	if (wrapCandidates >= SPLIT_MAX_WRAP_LINES) return false;
	if (wrapRatio >= SPLIT_MAX_WRAP_RATIO) return false;
	return true;
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXT_LANG: Record<string, BundledLanguage> = {
	ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
	mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
	rs: "rust", go: "go", java: "java", c: "c", cpp: "cpp",
	h: "c", hpp: "cpp", cs: "csharp", swift: "swift", kt: "kotlin",
	html: "html", css: "css", scss: "scss", json: "json",
	yaml: "yaml", yml: "yaml", toml: "toml", md: "markdown",
	sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
	lua: "lua", php: "php", dart: "dart", xml: "xml",
	graphql: "graphql", svelte: "svelte", vue: "vue",
};

function lang(fp: string): BundledLanguage | undefined {
	return EXT_LANG[extname(fp).slice(1).toLowerCase()];
}

// ---------------------------------------------------------------------------
// Shiki ANSI cache + pre-warm
// ---------------------------------------------------------------------------

codeToANSI("", "typescript", THEME).catch(() => {});

const _cache = new Map<string, string[]>();

function _touch(k: string, v: string[]): string[] {
	_cache.delete(k);
	_cache.set(k, v);
	while (_cache.size > CACHE_LIMIT) {
		const first = _cache.keys().next().value;
		if (first === undefined) break;
		_cache.delete(first);
	}
	return v;
}

async function hlBlock(code: string, language: BundledLanguage | undefined): Promise<string[]> {
	if (!code) return [""];
	if (!language || code.length > MAX_HL_CHARS) return code.split("\n");

	const k = `${THEME}\0${language}\0${code}`;
	const hit = _cache.get(k);
	if (hit) return _touch(k, hit);

	try {
		const ansi = normalizeShikiContrast(await codeToANSI(code, language, THEME));
		const out = (ansi.endsWith("\n") ? ansi.slice(0, -1) : ansi).split("\n");
		return _touch(k, out);
	} catch {
		return code.split("\n");
	}
}

// ---------------------------------------------------------------------------
// Diff parsing
// ---------------------------------------------------------------------------

function parseDiff(oldContent: string, newContent: string, ctx = 3): ParsedDiff {
	const patch = Diff.structuredPatch("", "", oldContent, newContent, "", "", { context: ctx });
	const lines: DiffLine[] = [];
	let added = 0,
		removed = 0;

	for (let hi = 0; hi < patch.hunks.length; hi++) {
		if (hi > 0) {
			const prev = patch.hunks[hi - 1];
			const gap = patch.hunks[hi].oldStart - (prev.oldStart + prev.oldLines);
			lines.push({ type: "sep", oldNum: null, newNum: gap > 0 ? gap : null, content: "" });
		}
		const h = patch.hunks[hi];
		let oL = h.oldStart,
			nL = h.newStart;
		for (const raw of h.lines) {
			if (raw === "\\ No newline at end of file") continue;
			const ch = raw[0],
				text = raw.slice(1);
			if (ch === "+") {
				lines.push({ type: "add", oldNum: null, newNum: nL++, content: text });
				added++;
			} else if (ch === "-") {
				lines.push({ type: "del", oldNum: oL++, newNum: null, content: text });
				removed++;
			} else {
				lines.push({ type: "ctx", oldNum: oL++, newNum: nL++, content: text });
			}
		}
	}
	return { lines, added, removed, chars: oldContent.length + newContent.length };
}

// ---------------------------------------------------------------------------
// Word diff + bg injection
// ---------------------------------------------------------------------------

function wordDiffAnalysis(
	a: string,
	b: string,
): {
	similarity: number;
	oldRanges: Array<[number, number]>;
	newRanges: Array<[number, number]>;
} {
	if (!a && !b) return { similarity: 1, oldRanges: [], newRanges: [] };
	const parts = Diff.diffWords(a, b);
	const oldRanges: Array<[number, number]> = [];
	const newRanges: Array<[number, number]> = [];
	let oPos = 0,
		nPos = 0,
		same = 0;
	for (const p of parts) {
		if (p.removed) {
			oldRanges.push([oPos, oPos + p.value.length]);
			oPos += p.value.length;
		} else if (p.added) {
			newRanges.push([nPos, nPos + p.value.length]);
			nPos += p.value.length;
		} else {
			const len = p.value.length;
			same += len;
			oPos += len;
			nPos += len;
		}
	}
	const maxLen = Math.max(a.length, b.length);
	return { similarity: maxLen > 0 ? same / maxLen : 1, oldRanges, newRanges };
}

function injectBg(ansiLine: string, ranges: Array<[number, number]>, baseBg: string, hlBg: string): string {
	if (!ranges.length) return baseBg + ansiLine + RST;

	let out = baseBg;
	let vis = 0;
	let inHL = false;
	let ri = 0;
	let i = 0;

	while (i < ansiLine.length) {
		if (ansiLine[i] === "\x1b") {
			const m = ansiLine.indexOf("m", i);
			if (m !== -1) {
				const seq = ansiLine.slice(i, m + 1);
				out += seq;
				if (seq === "\x1b[0m") out += inHL ? hlBg : baseBg;
				i = m + 1;
				continue;
			}
		}
		while (ri < ranges.length && vis >= ranges[ri][1]) ri++;
		const want = ri < ranges.length && vis >= ranges[ri][0] && vis < ranges[ri][1];
		if (want !== inHL) {
			inHL = want;
			out += inHL ? hlBg : baseBg;
		}
		out += ansiLine[i];
		vis++;
		i++;
	}
	return out + RST;
}

function plainWordDiff(oldText: string, newText: string): { old: string; new: string } {
	const parts = Diff.diffWords(oldText, newText);
	let o = "",
		n = "";
	for (const p of parts) {
		if (p.removed) o += `${BG_DEL_W}${p.value}${RST}${BG_DEL}`;
		else if (p.added) n += `${BG_ADD_W}${p.value}${RST}${BG_ADD}`;
		else {
			o += p.value;
			n += p.value;
		}
	}
	return { old: o, new: n };
}

// ---------------------------------------------------------------------------
// Unified view
// ---------------------------------------------------------------------------

async function renderUnified(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	max = MAX_RENDER_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
): Promise<string> {
	if (!diff.lines.length) return "";

	const vis = diff.lines.slice(0, max);
	const tw = termW();
	const nw = Math.max(2, String(Math.max(...vis.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const gw = nw + 5;
	const cw = Math.max(20, tw - gw);
	const canHL = diff.chars <= MAX_HL_CHARS && vis.length <= MAX_RENDER_LINES;

	const oldSrc: string[] = [],
		newSrc: string[] = [];
	for (const l of vis) {
		if (l.type === "ctx" || l.type === "del") oldSrc.push(l.content);
		if (l.type === "ctx" || l.type === "add") newSrc.push(l.content);
	}
	const [oldHL, newHL] = canHL
		? await Promise.all([hlBlock(oldSrc.join("\n"), language), hlBlock(newSrc.join("\n"), language)])
		: [oldSrc, newSrc];

	let oI = 0,
		nI = 0,
		idx = 0;
	const out: string[] = [];
	out.push(rule(tw));

	function emitRow(
		num: number | null,
		sign: string,
		gutterBg: string,
		signFg: string,
		body: string,
		bodyBg = "",
	): void {
		const borderFg = sign === "-" ? dc.fgDel : sign === "+" ? dc.fgAdd : "";
		const border = borderFg ? `${borderFg}${BORDER_BAR}${RST}` : `${BG_BASE} `;
		const numFg = borderFg || FG_LNUM;
		const gutter = `${border}${gutterBg}${lnum(num, nw, numFg)}${signFg}${sign}${RST} ${DIVIDER} `;
		const contGutter = `${border}${gutterBg}${" ".repeat(nw + 1)}${RST} ${DIVIDER} `;
		const rows = wrapAnsi(tabs(body), cw, adaptiveWrapRows(), bodyBg);
		out.push(`${gutter}${rows[0]}${RST}`);
		for (let r = 1; r < rows.length; r++) out.push(`${contGutter}${rows[r]}${RST}`);
	}

	while (idx < vis.length) {
		const l = vis[idx];

		if (l.type === "sep") {
			const gap = l.newNum;
			const label = gap && gap > 0 ? ` ${gap} unmodified lines ` : "···";
			const totalW = Math.min(tw, 72);
			const pad = Math.max(0, totalW - label.length - 2);
			const half1 = Math.floor(pad / 2),
				half2 = pad - half1;
			out.push(`${BG_BASE}${FG_DIM}${"─".repeat(half1)}${label}${"─".repeat(half2)}${RST}`);
			idx++;
			continue;
		}

		if (l.type === "ctx") {
			const hl = oldHL[oI] ?? l.content;
			emitRow(l.newNum, " ", BG_BASE, dc.fgCtx, `${BG_BASE}${DIM}${hl}`, BG_BASE);
			oI++;
			nI++;
			idx++;
			continue;
		}

		const dels: Array<{ l: DiffLine; hl: string }> = [];
		while (idx < vis.length && vis[idx].type === "del") {
			dels.push({ l: vis[idx], hl: oldHL[oI] ?? vis[idx].content });
			oI++;
			idx++;
		}
		const adds: Array<{ l: DiffLine; hl: string }> = [];
		while (idx < vis.length && vis[idx].type === "add") {
			adds.push({ l: vis[idx], hl: newHL[nI] ?? vis[idx].content });
			nI++;
			idx++;
		}

		const isPaired = dels.length === 1 && adds.length === 1;
		const wd = isPaired ? wordDiffAnalysis(dels[0].l.content, adds[0].l.content) : null;

		if (isPaired && wd && wd.similarity >= WORD_DIFF_MIN_SIM && canHL) {
			const delBody = injectBg(dels[0].hl, wd.oldRanges, BG_DEL, BG_DEL_W);
			const addBody = injectBg(adds[0].hl, wd.newRanges, BG_ADD, BG_ADD_W);
			emitRow(dels[0].l.oldNum, "-", BG_GUTTER_DEL, `${dc.fgDel}${BOLD}`, delBody, BG_DEL);
			emitRow(adds[0].l.newNum, "+", BG_GUTTER_ADD, `${dc.fgAdd}${BOLD}`, addBody, BG_ADD);
			continue;
		}
		if (isPaired && wd && wd.similarity >= WORD_DIFF_MIN_SIM && !canHL) {
			const pwd = plainWordDiff(dels[0].l.content, adds[0].l.content);
			emitRow(dels[0].l.oldNum, "-", BG_GUTTER_DEL, `${dc.fgDel}${BOLD}`, `${BG_DEL}${pwd.old}`, BG_DEL);
			emitRow(adds[0].l.newNum, "+", BG_GUTTER_ADD, `${dc.fgAdd}${BOLD}`, `${BG_ADD}${pwd.new}`, BG_ADD);
			continue;
		}

		for (const d of dels) {
			const body = canHL ? `${BG_DEL}${d.hl}` : `${BG_DEL}${d.l.content}`;
			emitRow(d.l.oldNum, "-", BG_GUTTER_DEL, `${dc.fgDel}${BOLD}`, body, BG_DEL);
		}
		for (const a of adds) {
			const body = canHL ? `${BG_ADD}${a.hl}` : `${BG_ADD}${a.l.content}`;
			emitRow(a.l.newNum, "+", BG_GUTTER_ADD, `${dc.fgAdd}${BOLD}`, body, BG_ADD);
		}
	}

	out.push(rule(tw));
	if (diff.lines.length > vis.length) {
		out.push(`${BG_BASE}${FG_DIM}  … ${diff.lines.length - vis.length} more lines${RST}`);
	}
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Split view
// ---------------------------------------------------------------------------

async function renderSplit(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	max = MAX_PREVIEW_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
): Promise<string> {
	const tw = termW();
	if (!shouldUseSplit(diff, tw, max)) return renderUnified(diff, language, max, dc);
	if (!diff.lines.length) return "";

	type Row = { left: DiffLine | null; right: DiffLine | null };
	const rows: Row[] = [];
	let i = 0;
	while (i < diff.lines.length) {
		const l = diff.lines[i];
		if (l.type === "sep" || l.type === "ctx") {
			rows.push({ left: l, right: l });
			i++;
			continue;
		}
		const dels: DiffLine[] = [],
			adds: DiffLine[] = [];
		while (i < diff.lines.length && diff.lines[i].type === "del") {
			dels.push(diff.lines[i]);
			i++;
		}
		while (i < diff.lines.length && diff.lines[i].type === "add") {
			adds.push(diff.lines[i]);
			i++;
		}
		const n = Math.max(dels.length, adds.length);
		for (let j = 0; j < n; j++) rows.push({ left: dels[j] ?? null, right: adds[j] ?? null });
	}

	const vis = rows.slice(0, max);
	const half = Math.floor((tw - 1) / 2);
	const nw = Math.max(2, String(Math.max(...diff.lines.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const gw = nw + 5;
	const cw = Math.max(12, half - gw);
	const canHL = diff.chars <= MAX_HL_CHARS && vis.length * 2 <= MAX_RENDER_LINES * 2;

	const leftSrc: string[] = [],
		rightSrc: string[] = [];
	for (const r of vis) {
		if (r.left && r.left.type !== "sep") leftSrc.push(r.left.content);
		if (r.right && r.right.type !== "sep") rightSrc.push(r.right.content);
	}
	const [leftHL, rightHL] = canHL
		? await Promise.all([hlBlock(leftSrc.join("\n"), language), hlBlock(rightSrc.join("\n"), language)])
		: [leftSrc, rightSrc];

	let lI = 0,
		rI = 0;
	let stripeRow = 0;

	type HalfResult = { gutter: string; contGutter: string; bodyRows: string[] };

	function half_build(
		line: DiffLine | null,
		hl: string,
		ranges: Array<[number, number]> | null,
		side: "left" | "right",
	): HalfResult {
		if (!line) {
			const gw2 = nw + 2;
			const gPat = FG_STRIPE + "╱".repeat(gw2) + RST;
			const g = ` ${gPat}${FG_RULE}│${RST} `;
			return { gutter: g, contGutter: g, bodyRows: [stripes(cw, stripeRow)] };
		}
		if (line.type === "sep") {
			const gap = line.newNum;
			const label = gap && gap > 0 ? `··· ${gap} lines ···` : "···";
			const g = `${BG_BASE} ${FG_DIM}${fit("", nw + 2)}${RST}${FG_RULE}│${RST} `;
			return { gutter: g, contGutter: g, bodyRows: [`${BG_BASE}${FG_DIM}${fit(label, cw)}${RST}`] };
		}

		const isDel = line.type === "del",
			isAdd = line.type === "add";
		const gBg = isDel ? BG_GUTTER_DEL : isAdd ? BG_GUTTER_ADD : BG_BASE;
		const cBg = isDel ? BG_DEL : isAdd ? BG_ADD : BG_BASE;
		const sFg = isDel ? dc.fgDel : isAdd ? dc.fgAdd : dc.fgCtx;
		const sign = isDel ? "-" : isAdd ? "+" : " ";
		const num = isDel ? line.oldNum : isAdd ? line.newNum : side === "left" ? line.oldNum : line.newNum;

		const borderFg = isDel ? dc.fgDel : isAdd ? dc.fgAdd : "";
		const border = borderFg ? `${borderFg}${BORDER_BAR}${RST}` : ` ${BG_BASE}`;
		const numFg = borderFg || FG_LNUM;

		let body: string;
		if (ranges && ranges.length > 0) {
			body = injectBg(hl, ranges, cBg, isDel ? BG_DEL_W : BG_ADD_W);
		} else if (isDel || isAdd) {
			body = `${cBg}${hl}`;
		} else {
			body = `${BG_BASE}${DIM}${hl}`;
		}

		const gutter = `${border}${gBg}${lnum(num, nw, numFg)}${sFg}${BOLD}${sign}${RST} ${FG_RULE}│${RST} `;
		const contGutter = `${border}${gBg}${" ".repeat(nw + 1)}${RST} ${FG_RULE}│${RST} `;
		const bodyRows = wrapAnsi(tabs(body), cw, adaptiveWrapRows(), cBg);
		return { gutter, contGutter, bodyRows };
	}

	const out: string[] = [];
	const hdrOld = `${BG_BASE}${" ".repeat(Math.max(0, nw - 2))}${dc.fgDel}${DIM}old${RST}`;
	const hdrNew = `${BG_BASE}${" ".repeat(Math.max(0, nw - 2))}${dc.fgAdd}${DIM}new${RST}`;
	out.push(`${BG_BASE}${hdrOld}${" ".repeat(Math.max(0, half - nw - 1))}${FG_RULE}┊${RST}${hdrNew}`);
	out.push(`${rule(half)}${FG_RULE}┊${RST}${rule(half)}`);

	for (const r of vis) {
		const leftLine = r.left,
			rightLine = r.right;
		const paired = leftLine && rightLine && leftLine.type === "del" && rightLine.type === "add";
		const wd = paired ? wordDiffAnalysis(leftLine.content, rightLine.content) : null;

		let lResult: HalfResult, rResult: HalfResult;

		if (paired && wd && wd.similarity >= WORD_DIFF_MIN_SIM && canHL) {
			const lhl = leftHL[lI++] ?? leftLine.content;
			const rhl = rightHL[rI++] ?? rightLine.content;
			lResult = half_build(leftLine, lhl, wd.oldRanges, "left");
			rResult = half_build(rightLine, rhl, wd.newRanges, "right");
		} else if (paired && wd && wd.similarity >= WORD_DIFF_MIN_SIM && !canHL) {
			const pwd = plainWordDiff(leftLine.content, rightLine.content);
			lI++;
			rI++;
			lResult = half_build(leftLine, pwd.old, null, "left");
			rResult = half_build(rightLine, pwd.new, null, "right");
		} else {
			const lhl = leftLine && leftLine.type !== "sep" ? (leftHL[lI++] ?? leftLine?.content ?? "") : "";
			const rhl = rightLine && rightLine.type !== "sep" ? (rightHL[rI++] ?? rightLine?.content ?? "") : "";
			lResult = half_build(leftLine, lhl, null, "left");
			rResult = half_build(rightLine, rhl, null, "right");
		}

		const maxRows = Math.max(lResult.bodyRows.length, rResult.bodyRows.length);
		const leftIsEmpty = !r.left;
		const rightIsEmpty = !r.right;
		for (let row = 0; row < maxRows; row++) {
			const lg = row === 0 ? lResult.gutter : lResult.contGutter;
			const rg = row === 0 ? rResult.gutter : rResult.contGutter;
			const lb = lResult.bodyRows[row] ?? (leftIsEmpty ? stripes(cw, stripeRow) : `${BG_EMPTY}${" ".repeat(cw)}${RST}`);
			const rb =
				rResult.bodyRows[row] ?? (rightIsEmpty ? stripes(cw, stripeRow) : `${BG_EMPTY}${" ".repeat(cw)}${RST}`);
			out.push(`${lg}${lb}${DIVIDER}${rg}${rb}`);
			stripeRow++;
		}
	}

	out.push(`${rule(half)}${FG_RULE}┊${RST}${rule(half)}`);
	if (rows.length > vis.length) {
		out.push(`${BG_BASE}${FG_DIM}  … ${rows.length - vis.length} more lines${RST}`);
	}
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Public API — register write/edit tools with diff rendering
// ---------------------------------------------------------------------------

export function registerDiffTools(pi: any): void {
	applyDiffPalette();

	// Static imports (top of file) instead of runtime require():
	// pi's jiti loader runs with moduleCache:false, so a require() here
	// re-evaluated the entire SDK module graph (~700ms) on every startup.
	const createWriteFn: any = createWriteTool;
	const createEditFn: any = createEditTool;
	const keyHintFn: any = keyHint;
	const TextComponent: any = Text;
	const pillFn: any = pill;
	if (!createWriteFn || !createEditFn || !TextComponent) return;

	const cwd = process.cwd();
	const home = process.env.HOME ?? "";
	const sp = (p: string) => shortPath(cwd, home, p);

	/** Max diff lines shown collapsed vs expanded */
	const COLLAPSED_DIFF_LINES = 30;
	const COLLAPSED_NEW_FILE_LINES = 12;

	/** Expand hint text */
	function expandHint(theme: any): string {
		const hint = keyHintFn ? keyHintFn("app.tools.expand", "to expand") : "expand to see more";
		return theme.fg("dim", `… (${hint})`);
	}

	/** Get raw text from tool result (fallback rendering) */
	function fallbackText(result: any, theme: any): string {
		const raw = result?.content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text || "")
			.join("\n") ?? "";
		return raw ? theme.fg("dim", raw.slice(0, 200)) : "";
	}

	/** Render a pill header for write/create/edit */
	function header(label: string, fp: string, theme: any): string {
		const p = pillFn ? pillFn(label, theme) : theme.fg("toolTitle", theme.bold(label));
		return `${p} ${theme.fg("accent", sp(fp))}`;
	}

	// =======================================================================
	// write
	// =======================================================================

	const origWrite = createWriteFn(cwd);

	pi.registerTool({
		...origWrite,
		parameters: { ...origWrite.parameters },

		async execute(tid: string, params: any, sig: any, upd: any, ctx: any) {
			const fp = params.path ?? params.file_path ?? "";
			let old: string | null = null;
			try {
				if (fp && existsSync(fp)) old = readFileSync(fp, "utf-8");
			} catch {
				old = null;
			}

			// Store isNew decision in state so renderCall/renderResult stay consistent
			if (ctx.state) ctx.state._isNewFile = old === null;

			const result = await origWrite.execute(tid, params, sig, upd, ctx);
			const content = params.content ?? "";

			try {
				if (old !== null && old !== content) {
					const diff = parseDiff(old, content);
					const lg = lang(fp);
					(result as any).details = {
						_type: "diff",
						summary: summarize(diff.added, diff.removed),
						diff,
						language: lg,
					};
				} else if (old === null) {
					const lineCount = content ? content.split("\n").length : 0;
					(result as any).details = {
						_type: "new",
						lines: lineCount,
						content: content ?? "",
						filePath: fp,
					};
				} else if (old === content) {
					(result as any).details = { _type: "noChange" };
				}
			} catch {
				// Fallback: if diff computation fails, just report success
				(result as any).details = { _type: "fallback" };
			}
			return result;
		},

		renderCall(args: any, theme: any, ctx: any) {
			const fp = args?.path ?? args?.file_path ?? "";
			// Use state from execute if available, otherwise check filesystem
			const isNew = ctx.state?._isNewFile ?? (!fp || !existsSync(fp));
			const label = isNew ? "create" : "write";
			const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
			const hdr = header(label, fp, theme);

			// Streaming: show line count progress
			if (args?.content && !ctx.argsComplete) {
				const n = String(args.content).split("\n").length;
				text.setText(`${hdr}  ${theme.fg("muted", `(${n} lines…)`)}`);
				return text;
			}

			// Create preview: syntax-highlight new file content
			if (args?.content && ctx.argsComplete && isNew) {
				const previewKey = `create:${fp}:${String(args.content).length}:${ctx.expanded}`;
				if (ctx.state._previewKey !== previewKey) {
					ctx.state._previewKey = previewKey;
					ctx.state._previewText = hdr;
					const lg = lang(fp);
					hlBlock(args.content, lg)
						.then((lines: string[]) => {
							if (ctx.state._previewKey !== previewKey) return;
							const maxShow = ctx.expanded ? lines.length : COLLAPSED_NEW_FILE_LINES;
							const preview = lines.slice(0, maxShow).join("\n");
							const rem = lines.length - maxShow;
							let out = `${hdr}\n\n${preview}`;
							if (rem > 0) out += `\n${expandHint(theme)}`;
							ctx.state._previewText = out;
							ctx.invalidate();
						})
						.catch(() => {
							// Fallback: show plain content
							const lines = args.content.split("\n");
							const maxShow = ctx.expanded ? lines.length : COLLAPSED_NEW_FILE_LINES;
							const preview = lines.slice(0, maxShow).join("\n");
							const rem = lines.length - maxShow;
							let out = `${hdr}\n\n${preview}`;
							if (rem > 0) out += `\n${expandHint(theme)}`;
							ctx.state._previewText = out;
							ctx.invalidate();
						});
				}
				text.setText(ctx.state._previewText ?? hdr);
				return text;
			}

			text.setText(hdr);
			return text;
		},

		renderResult(result: any, opts: any, theme: any, ctx: any) {
			const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
			const expanded = opts?.expanded ?? ctx.expanded ?? false;

			if (ctx.isError) {
				const e =
					result.content
						?.filter((c: any) => c.type === "text")
						.map((c: any) => c.text || "")
						.join("\n") ?? "Error";
				text.setText(`\n${theme.fg("error", e)}`);
				return text;
			}

			const d = result.details;

			// Diff result (overwrite of existing file)
			if (d?._type === "diff") {
				const w = termW();
				const maxLines = expanded ? MAX_RENDER_LINES : COLLAPSED_DIFF_LINES;
				const key = `wd:${w}:${maxLines}:${d.summary}:${d.diff?.lines?.length ?? 0}:${d.language ?? ""}`;
				if (ctx.state._wdk !== key) {
					ctx.state._wdk = key;
					ctx.state._wdt = `  ${d.summary}\n${theme.fg("muted", "  rendering diff…")}`;
					try {
						const dc = resolveDiffColors(theme);
						renderSplit(d.diff, d.language, maxLines, dc)
							.then((rendered: string) => {
								if (ctx.state._wdk !== key) return;
								let out = `  ${d.summary}\n${rendered}`;
								if (!expanded && d.diff.lines.length > COLLAPSED_DIFF_LINES) {
									out += `\n${expandHint(theme)}`;
								}
								ctx.state._wdt = out;
								ctx.invalidate();
							})
							.catch(() => {
								if (ctx.state._wdk !== key) return;
								ctx.state._wdt = `  ${d.summary}`;
								ctx.invalidate();
							});
					} catch {
						ctx.state._wdt = `  ${d.summary}`;
					}
				}
				text.setText(ctx.state._wdt ?? `  ${d.summary}`);
				return text;
			}

			// No changes
			if (d?._type === "noChange") {
				text.setText(`  ${theme.fg("muted", "✓ no changes")}`);
				return text;
			}

			// New file
			if (d?._type === "new") {
				const { lines: lineCount, content: rawContent, filePath: fp } = d;
				const maxShow = expanded ? Infinity : COLLAPSED_NEW_FILE_LINES;
				const pk = `nf:${fp}:${lineCount}:${maxShow}`;
				if (ctx.state._nfk !== pk) {
					ctx.state._nfk = pk;
					ctx.state._nft = `  ${theme.fg("success", `✓ new file (${lineCount} lines)`)}`;
					const lg = lang(fp);
					if (rawContent) {
						hlBlock(rawContent, lg)
							.then((hlLines: string[]) => {
								if (ctx.state._nfk !== pk) return;
								const shown = hlLines.slice(0, maxShow);
								const preview = shown.join("\n");
								const rem = hlLines.length - shown.length;
								let out = `  ${theme.fg("success", `✓ new file (${lineCount} lines)`)}\n${preview}`;
								if (rem > 0) out += `\n${expandHint(theme)}`;
								ctx.state._nft = out;
								ctx.invalidate();
							})
							.catch(() => {
								// Fallback: plain text preview
								const lines = rawContent.split("\n");
								const shown = lines.slice(0, maxShow);
								const rem = lines.length - shown.length;
								let out = `  ${theme.fg("success", `✓ new file (${lineCount} lines)`)}\n${shown.join("\n")}`;
								if (rem > 0) out += `\n${expandHint(theme)}`;
								ctx.state._nft = out;
								ctx.invalidate();
							});
					}
				}
				text.setText(ctx.state._nft ?? `  ${theme.fg("success", `✓ new file (${lineCount} lines)`)}`);
				return text;
			}

			// Fallback: show raw result text
			const fb = fallbackText(result, theme);
			text.setText(fb ? `  ${fb}` : `  ${theme.fg("dim", "written")}`);
			return text;
		},
	});

	// =======================================================================
	// edit
	// =======================================================================

	const origEdit = createEditFn(cwd);

	function getEditOperations(input: any): Array<{ oldText: string; newText: string }> {
		if (Array.isArray(input?.edits)) {
			return input.edits
				.map((edit: any) => ({
					oldText:
						typeof edit?.oldText === "string"
							? edit.oldText
							: typeof edit?.old_text === "string"
								? edit.old_text
								: "",
					newText:
						typeof edit?.newText === "string"
							? edit.newText
							: typeof edit?.new_text === "string"
								? edit.new_text
								: "",
				}))
				.filter((edit: { oldText: string; newText: string }) => edit.oldText !== edit.newText);
		}

		const oldText =
			typeof input?.oldText === "string"
				? input.oldText
				: typeof input?.old_text === "string"
					? input.old_text
					: "";
		const newText =
			typeof input?.newText === "string"
				? input.newText
				: typeof input?.new_text === "string"
					? input.new_text
					: "";
		return oldText !== newText ? [{ oldText, newText }] : [];
	}

	function summarizeEditOperations(operations: Array<{ oldText: string; newText: string }>) {
		const diffs = operations.map((edit) => parseDiff(edit.oldText, edit.newText));
		const totalAdded = diffs.reduce((sum, diff) => sum + diff.added, 0);
		const totalRemoved = diffs.reduce((sum, diff) => sum + diff.removed, 0);
		return {
			diffs,
			totalAdded,
			totalRemoved,
			summary: summarize(totalAdded, totalRemoved),
		};
	}

	pi.registerTool({
		...origEdit,
		parameters: { ...origEdit.parameters },

		async execute(tid: string, params: any, sig: any, upd: any, ctx: any) {
			const fp = params.path ?? params.file_path ?? "";
			const operations = getEditOperations(params);

			// Read old content BEFORE executing, to find correct line offset
			let preEditContent: string | null = null;
			try {
				if (fp && existsSync(fp)) preEditContent = readFileSync(fp, "utf-8");
			} catch {
				preEditContent = null;
			}

			const result = await origEdit.execute(tid, params, sig, upd, ctx);

			if (operations.length === 0) return result;

			try {
				const { diffs, summary } = summarizeEditOperations(operations);
				if (operations.length === 1) {
					let editLine = 0;
					// Use pre-edit content to find oldText position (not newText)
					if (preEditContent && operations[0].oldText) {
						const idx = preEditContent.indexOf(operations[0].oldText);
						if (idx >= 0) editLine = preEditContent.slice(0, idx).split("\n").length;
					}
					(result as any).details = { _type: "editInfo", summary, editLine };
					return result;
				}

				(result as any).details = {
					_type: "multiEditInfo",
					summary,
					editCount: operations.length,
					diffLineCount: diffs.reduce((sum, diff) => sum + diff.lines.length, 0),
				};
			} catch {
				(result as any).details = { _type: "fallback" };
			}
			return result;
		},

		renderCall(args: any, theme: any, ctx: any) {
			const fp = args?.path ?? args?.file_path ?? "";
			const operations = getEditOperations(args);
			const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
			const hdr = header("edit", fp, theme);

			if (!(ctx.argsComplete && operations.length > 0)) {
				text.setText(hdr);
				return text;
			}

			const expanded = ctx.expanded ?? false;
			const pk = JSON.stringify({ fp, operations, w: termW(), expanded });
			if (ctx.state._pk !== pk) {
				ctx.state._pk = pk;
				ctx.state._pt = `${hdr}  ${theme.fg("muted", "(rendering…)")}`;
				const lg = lang(fp);
				const dc = resolveDiffColors(theme);
				const maxLines = expanded ? MAX_PREVIEW_LINES : COLLAPSED_DIFF_LINES;

				if (operations.length === 1) {
					const diff = parseDiff(operations[0].oldText, operations[0].newText);
					renderSplit(diff, lg, maxLines, dc)
						.then((rendered) => {
							if (ctx.state._pk !== pk) return;
							let out = `${hdr}\n${summarize(diff.added, diff.removed)}\n${rendered}`;
							if (!expanded && diff.lines.length > COLLAPSED_DIFF_LINES) {
								out += `\n${expandHint(theme)}`;
							}
							ctx.state._pt = out;
							ctx.invalidate();
						})
						.catch(() => {
							if (ctx.state._pk !== pk) return;
							ctx.state._pt = `${hdr}  ${summarize(diff.added, diff.removed)}`;
							ctx.invalidate();
						});
				} else {
					const { diffs, summary } = summarizeEditOperations(operations);
					const maxShown = Math.min(operations.length, 3);
					const previewLines = Math.max(8, Math.floor(maxLines / maxShown));
					Promise.all(
						diffs.slice(0, maxShown).map((diff, index) =>
							renderSplit(diff, lg, previewLines, dc)
								.then((rendered) => `Edit ${index + 1}/${operations.length}\n${rendered}`)
								.catch(() => `Edit ${index + 1}/${operations.length}  ${summarize(diff.added, diff.removed)}`),
						),
					)
						.then((sections) => {
							if (ctx.state._pk !== pk) return;
							const remainder = operations.length - maxShown;
							const suffix =
								remainder > 0
									? `\n${theme.fg("muted", `… ${remainder} more edit blocks`)}`
									: "";
							ctx.state._pt = `${hdr}\n${operations.length} edits ${summary}\n\n${sections.join("\n\n")}${suffix}`;
							ctx.invalidate();
						})
						.catch(() => {
							if (ctx.state._pk !== pk) return;
							ctx.state._pt = `${hdr}  ${operations.length} edits ${summary}`;
							ctx.invalidate();
						});
				}
			}

			text.setText(ctx.state._pt ?? hdr);
			return text;
		},

		renderResult(result: any, opts: any, theme: any, ctx: any) {
			const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
			const expanded = opts?.expanded ?? ctx.expanded ?? false;

			if (ctx.isError) {
				const e =
					result.content
						?.filter((c: any) => c.type === "text")
						.map((c: any) => c.text || "")
						.join("\n") ?? "Error";
				text.setText(`\n${theme.fg("error", e)}`);
				return text;
			}

			if (result.details?._type === "editInfo") {
				const { summary: s, editLine } = result.details;
				const loc = editLine > 0 ? ` ${theme.fg("muted", `at line ${editLine}`)}` : "";
				text.setText(`  ${s}${loc}`);
				return text;
			}

			if (result.details?._type === "multiEditInfo") {
				const { summary: s, editCount, diffLineCount } = result.details;
				const dlInfo =
					typeof diffLineCount === "number"
						? ` ${theme.fg("muted", `(${diffLineCount} diff lines)`)}`
						: "";
				text.setText(`  ${editCount} edits ${s}${dlInfo}`);
				return text;
			}

			// Fallback
			const fb = fallbackText(result, theme);
			text.setText(fb ? `  ${fb}` : `  ${theme.fg("dim", "edited")}`);
			return text;
		},
	});
}
