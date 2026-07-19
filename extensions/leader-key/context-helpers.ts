/**
 * Safe helpers for ExtensionCommandContext methods.
 *
 * Shortcut handlers receive ExtensionContext (no session navigation methods).
 * Command handlers receive ExtensionCommandContext (with switchSession, etc.).
 * These helpers do a runtime check and fall back to internal slash commands
 * (which do get ExtensionCommandContext).
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionCommandContext,
	SessionManager,
} from "@mariozechner/pi-coding-agent";

type SessionTreeNode = ReturnType<SessionManager["getTree"]>[number];

/** Check if ctx has full command context capabilities. */
function isCommandCtx(ctx: ExtensionContext): ctx is ExtensionCommandContext {
	return "switchSession" in ctx && typeof (ctx as any).switchSession === "function";
}

/** Emit a slash command via the editor input. */
function emitCommand(ctx: ExtensionContext, command: string) {
	ctx.ui.setEditorText(command);
	setTimeout(() => process.stdin.emit("data", "\r"), 0);
}

/**
 * Navigate to a tree entry. Uses the direct API when available,
 * falls back to the internal /lk-navigate command.
 */
export async function tryNavigateTree(ctx: ExtensionContext, targetId: string) {
	if (isCommandCtx(ctx)) {
		await ctx.navigateTree(targetId);
	} else {
		emitCommand(ctx, `/lk-navigate ${targetId}`);
	}
}

/**
 * Switch to a different session file. Uses the direct API when available,
 * falls back to the internal /lk-switch command.
 */
export async function trySwitchSession(ctx: ExtensionContext, sessionPath: string) {
	if (isCommandCtx(ctx)) {
		await ctx.switchSession(sessionPath);
	} else {
		emitCommand(ctx, `/lk-switch ${sessionPath}`);
	}
}

/**
 * Register internal bridge commands that provide ExtensionCommandContext
 * for actions triggered from shortcut handlers.
 */
export function registerBridgeCommands(pi: ExtensionAPI) {
	pi.registerCommand("lk-navigate", {
		description: "(internal) Navigate to a tree entry by ID",
		handler: async (args, ctx) => {
			const targetId = args.trim();
			if (!targetId) return;
			await ctx.navigateTree(targetId);
		},
	});

	pi.registerCommand("lk-switch", {
		description: "(internal) Switch to a session file by path",
		handler: async (args, ctx) => {
			const sessionPath = args.trim();
			if (!sessionPath) return;
			await ctx.switchSession(sessionPath);
		},
	});
}

/** Entry preview extracted from the tree node. */
export interface LabeledEntry {
	id: string;
	label: string;
	preview: string;
}

/**
 * Collect all labeled entries from the session tree.
 * Shared by "Clear label" and "Go to label" actions.
 */
export function collectLabeledEntries(tree: SessionTreeNode[]): LabeledEntry[] {
	const labeled: LabeledEntry[] = [];

	function walk(nodes: SessionTreeNode[]) {
		for (const node of nodes) {
			if (node.label) {
				let preview = "";
				if (node.entry.type === "message" && "content" in node.entry.message) {
					const content: unknown = node.entry.message.content;
					if (typeof content === "string") {
						preview = content.slice(0, 60);
					} else if (Array.isArray(content)) {
						const text = content.find((c: any) => c.type === "text");
						if (text && "text" in text) preview = (text as any).text.slice(0, 60);
					}
				}
				labeled.push({ id: node.entry.id, label: node.label, preview });
			}
			walk(node.children);
		}
	}

	walk(tree);
	return labeled;
}
