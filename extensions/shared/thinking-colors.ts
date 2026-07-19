import type { ThemeColor } from "@mariozechner/pi-coding-agent";

/** Theme roles for thinking-level indicators. Shared across pickers and footer. */
export const THINKING_ROLES: Record<string, ThemeColor> = {
	off:     "dim",
	minimal: "dim",
	low:     "success",
	medium:  "warning",
	high:    "bashMode",
	xhigh:  "error",
};
