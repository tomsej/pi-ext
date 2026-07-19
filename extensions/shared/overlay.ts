/**
 * Shared overlay frame utility for bordered UI panels.
 *
 * Eliminates duplicated box-drawing, padding, and row helpers
 * across leader-key, favourite-models, model-switcher, etc.
 */

import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";

// Method syntax (not arrow-property) so the real `Theme` class — whose fg()
// takes the narrower ThemeColor union — stays assignable (bivariant method check).
type ThemeLike = {
	fg(role: string, text: string): string;
	bold(text: string): string;
};

/** Pad a (possibly ANSI-styled) string to exact visible width. */
export function padToWidth(s: string, len: number): string {
	const vis = visibleWidth(s);
	return s + " ".repeat(Math.max(0, len - vis));
}

/**
 * A bordered overlay frame builder.
 *
 * Usage:
 *   const f = new OverlayFrame(width, theme);
 *   lines.push(f.top());
 *   lines.push(f.row(theme.fg("accent", theme.bold("Title"))));
 *   lines.push(f.separator());
 *   lines.push(f.row(someContent));
 *   lines.push(f.bottom());
 */
export class OverlayFrame {
	/** Effective max width of the frame (clamped to maxWidth). */
	readonly width: number;
	/** Usable content width inside the borders (width - 4). */
	readonly innerWidth: number;

	private hLine: string;
	private theme: ThemeLike;

	constructor(terminalWidth: number, theme: ThemeLike, maxWidth = 80) {
		this.width = Math.min(terminalWidth, maxWidth);
		this.innerWidth = this.width - 4;
		this.hLine = "─".repeat(this.width - 2);
		this.theme = theme;
	}

	/** Top border: ╭───╮ */
	top(): string {
		return this.theme.fg("border", `╭${this.hLine}╮`);
	}

	/** Horizontal separator: ├───┤ */
	separator(): string {
		return this.theme.fg("border", `├${this.hLine}┤`);
	}

	/** Bottom border: ╰───╯ */
	bottom(): string {
		return this.theme.fg("border", `╰${this.hLine}╯`);
	}

	/** A content row padded to fill the frame: │ content │ */
	row(content: string): string {
		const th = this.theme;
		return th.fg("border", "│") + " " + padToWidth(content, this.innerWidth) + " " + th.fg("border", "│");
	}

	/** A content row, truncated if too wide: │ content… │ */
	rowTruncated(content: string): string {
		return this.row(truncateToWidth(content, this.innerWidth));
	}
}
