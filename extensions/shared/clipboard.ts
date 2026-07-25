/**
 * Clipboard Utility
 *
 * Cross-platform clipboard copy using system tools.
 */

import { execSync } from "node:child_process";

/** Copy text to system clipboard. Returns true on success. */
export function copyToClipboard(text: string): boolean {
	try {
		if (process.platform === "darwin") {
			execSync("pbcopy", { input: text, timeout: 3000 });
		} else if (process.platform === "win32") {
			execSync("clip", { input: text, timeout: 3000 });
		} else {
			// Linux — try xclip, then xsel
			try {
				execSync("xclip -selection clipboard", { input: text, timeout: 3000 });
			} catch {
				execSync("xsel --clipboard --input", { input: text, timeout: 3000 });
			}
		}
		return true;
	} catch {
		return false;
	}
}
