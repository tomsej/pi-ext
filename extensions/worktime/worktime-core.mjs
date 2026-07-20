/**
 * Active-time state machine. Accumulates spans between start() and end();
 * reset() zeroes the count (per new prompt) while keeping a live run going.
 * `now` is injectable for tests.
 */
export function createWorktime(now = () => Date.now()) {
	let totalMs = 0;
	let runStart = null;
	return {
		reset() {
			totalMs = 0;
			if (runStart != null) runStart = now();
		},
		start() {
			if (runStart == null) runStart = now();
		},
		end() {
			if (runStart != null) {
				totalMs += now() - runStart;
				runStart = null;
			}
		},
		elapsed() {
			return totalMs + (runStart != null ? now() - runStart : 0);
		},
		get running() {
			return runStart != null;
		},
	};
}

/** Format a duration in milliseconds as a compact "1h 2m 3s" string. */
export function formatDuration(ms) {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}
