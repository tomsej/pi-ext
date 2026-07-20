import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorktime, formatDuration } from "./worktime-core.mjs";

test("seconds only", () => assert.equal(formatDuration(5_000), "5s"));
test("minutes and seconds", () => assert.equal(formatDuration(125_000), "2m 5s"));
test("hours, minutes, seconds", () => assert.equal(formatDuration(3_723_000), "1h 2m 3s"));
test("negative clamps to 0s", () => assert.equal(formatDuration(-1), "0s"));

test("accumulates active spans, ignores idle time", () => {
	let t = 0;
	const wt = createWorktime(() => t);
	wt.start();
	t = 5000;
	wt.end();
	t = 20000; // idle, not counted
	assert.equal(wt.elapsed(), 5000);
	assert.equal(wt.running, false);
});

test("reset zeroes the count but keeps a live run going", () => {
	let t = 0;
	const wt = createWorktime(() => t);
	wt.start();
	t = 8000;
	wt.reset(); // new prompt mid-run
	assert.equal(wt.running, true);
	t = 11000;
	assert.equal(wt.elapsed(), 3000);
});

test("reset while idle clears accumulated time", () => {
	let t = 0;
	const wt = createWorktime(() => t);
	wt.start();
	t = 4000;
	wt.end();
	wt.reset();
	assert.equal(wt.elapsed(), 0);
});
