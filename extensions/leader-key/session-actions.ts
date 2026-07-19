/**
 * Session-related leader-key actions: session tree, session picker.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { TreeSelectorComponent, SessionSelectorComponent, SessionManager } from "@mariozechner/pi-coding-agent";
import type { TopLevelEntry } from "./types.js";
import { tryNavigateTree, trySwitchSession } from "./context-helpers.js";

async function openSessionTree(pi: ExtensionAPI, ctx: ExtensionContext) {
	const tree = ctx.sessionManager.getTree();
	const currentLeafId = ctx.sessionManager.getLeafId();

	const selectedId = await ctx.ui.custom<string | null>(
		(tui, _theme, _kb, done) => {
			const termRows = tui.terminal?.rows ?? 40;
			const selector = new TreeSelectorComponent(
				tree,
				currentLeafId,
				termRows,
				(entryId) => done(entryId),
				() => done(null),
				(entryId, label) => pi.setLabel(entryId, label),
			);
			return {
				render: (w: number) => selector.render(w),
				invalidate: () => selector.invalidate(),
				handleInput: (data: string) => {
					selector.handleInput(data);
					tui.requestRender();
				},
			};
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "90%",
				minWidth: 60,
				maxHeight: "85%",
			},
		},
	);

	if (selectedId && selectedId !== currentLeafId) {
		await tryNavigateTree(ctx, selectedId);
	}
}

async function openSessionPicker(pi: ExtensionAPI, ctx: ExtensionContext) {
	const currentCwd = ctx.cwd;
	const currentSessionFilePath = ctx.sessionManager.getSessionFile();

	const currentSessionsLoader = async (onProgress?: (loaded: number, total: number) => void) => {
		return SessionManager.list(currentCwd, undefined, onProgress);
	};
	const allSessionsLoader = async (onProgress?: (loaded: number, total: number) => void) => {
		return SessionManager.listAll(onProgress);
	};

	const selectedPath = await ctx.ui.custom<string | null>(
		(tui, _theme, _kb, done) => {
			const selector = new SessionSelectorComponent(
				currentSessionsLoader,
				allSessionsLoader,
				(sessionPath) => done(sessionPath),
				() => done(null),
				() => done(null),
				() => tui.requestRender(),
				{
					renameSession: async (sessionPath, currentName) => {
						const name = (currentName ?? "").trim();
						const mgr = SessionManager.open(sessionPath);
						// pi >=0.80: session name lives in a session_info entry.
						mgr.appendSessionInfo(name);
					},
					showRenameHint: true,
				},
				currentSessionFilePath,
			);
			return {
				render: (w: number) => selector.render(w),
				invalidate: () => selector.invalidate(),
				handleInput: (data: string) => {
					selector.handleInput(data);
					tui.requestRender();
				},
			};
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "90%",
				minWidth: 60,
				maxHeight: "85%",
			},
		},
	);

	if (selectedPath) {
		await trySwitchSession(ctx, selectedPath);
	}
}

export function buildSessionEntries(pi: ExtensionAPI): TopLevelEntry {
	return {
		type: "group",
		group: {
			key: "s",
			label: "Session",
			items: [
				{
					key: "n",
					label: "New session",
					description: "start fresh",
					action: (ctx) => {
						ctx.ui.setEditorText("/new");
						setTimeout(() => process.stdin.emit("data", "\r"), 0);
					},
				},
				{
					key: "s",
					label: "Resume session",
					description: "pick & switch",
					action: (ctx) => openSessionPicker(pi, ctx),
				},
				{
					key: "t",
					label: "Session tree",
					description: "navigate branches",
					action: (ctx) => openSessionTree(pi, ctx),
				},
				{
					key: "c",
					label: "Compact",
					description: "LLM summary",
					action: (ctx) => {
						ctx.ui.setEditorText("/compact");
						setTimeout(() => process.stdin.emit("data", "\r"), 0);
					},
				},
				{
					key: "v",
					label: "Compact with VCC",
					description: "algorithmic summary",
					action: (ctx) => {
						ctx.ui.setEditorText("/pi-vcc");
						setTimeout(() => process.stdin.emit("data", "\r"), 0);
					},
				},
			],
		},
	};
}
