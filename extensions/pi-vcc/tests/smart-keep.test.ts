import { describe, test, expect } from "bun:test";
import { resolveSmartKeepUserTurns } from "../src/hooks/before-compact";

const msg = (id: string, role: "user" | "assistant" | "toolResult", content = "x") => ({
  id,
  type: "message",
  message: { role, content },
});

// Helper to build a long content string of roughly N tokens (4 chars/token).
const tokenContent = (n: number): string => "a".repeat(n * 4);

describe("resolveSmartKeepUserTurns", () => {
  test("smart disabled → old behavior, keep base (1)", () => {
    const entries = [
      msg("u1", "user", tokenContent(3)),
      msg("a1", "assistant", tokenContent(3)),
      msg("u2", "user", tokenContent(3)),
      msg("a2", "assistant", tokenContent(3)),
    ];
    const r = resolveSmartKeepUserTurns({
      branchEntries: entries,
      requestedKeepUserTurns: null,
      explicit: false,
      smartKeepTail: false,
      minTokens: 10,
      maxTokens: 40,
    });
    expect(r.keepUserTurns).toBe(1);
    expect(r.smartAdjusted).toBe(false);
  });

  test("explicit keep:N is respected, never adjusted", () => {
    const entries = [
      msg("u1", "user", tokenContent(3)),
      msg("a1", "assistant", tokenContent(3)),
      msg("u2", "user", tokenContent(3)),
      msg("a2", "assistant", tokenContent(3)),
      msg("u3", "user", tokenContent(3)),
      msg("a3", "assistant", tokenContent(3)),
    ];
    const r = resolveSmartKeepUserTurns({
      branchEntries: entries,
      requestedKeepUserTurns: 2,
      explicit: true,
      smartKeepTail: true,
      minTokens: 10,
      maxTokens: 40,
    });
    expect(r.keepUserTurns).toBe(2);
    expect(r.smartAdjusted).toBe(false);
  });

  test("keep:1 tail <= min → boost to largest safe N before compact-all boundary", () => {
    // Each user+assistant turn pair = 3+3 = 6 tokens.
    // keep:1 tail = u3+a3 = 6 tokens (<= min 10).
    // keep:2 tail = u2+a2+u3+a3 = 12 (<= max 40).
    // keep:3 would keep all user turns, which buildOwnCut treats as compact-all.
    // → select 2.
    const entries = [
      msg("u1", "user", tokenContent(3)),
      msg("a1", "assistant", tokenContent(3)),
      msg("u2", "user", tokenContent(3)),
      msg("a2", "assistant", tokenContent(3)),
      msg("u3", "user", tokenContent(3)),
      msg("a3", "assistant", tokenContent(3)),
    ];
    const r = resolveSmartKeepUserTurns({
      branchEntries: entries,
      requestedKeepUserTurns: null,
      explicit: false,
      smartKeepTail: true,
      minTokens: 10,
      maxTokens: 40,
    });
    expect(r.keepUserTurns).toBe(2);
    expect(r.smartAdjusted).toBe(true);
    expect(r.fromKeep).toBe(1);
  });

  test("keep:1 tail <= min but keep:2 > max → keep 1", () => {
    // keep:1 tail = 6 tokens (<= min 10).
    // keep:2 tail = 12 (> max 11) → stop, keep 1.
    const entries = [
      msg("u1", "user", tokenContent(3)),
      msg("a1", "assistant", tokenContent(3)),
      msg("u2", "user", tokenContent(3)),
      msg("a2", "assistant", tokenContent(3)),
      msg("u3", "user", tokenContent(3)),
      msg("a3", "assistant", tokenContent(3)),
    ];
    const r = resolveSmartKeepUserTurns({
      branchEntries: entries,
      requestedKeepUserTurns: null,
      explicit: false,
      smartKeepTail: true,
      minTokens: 10,
      maxTokens: 11,
    });
    expect(r.keepUserTurns).toBe(1);
    expect(r.smartAdjusted).toBe(false);
  });

  test("keep:1 tail > min → no boost (already above threshold)", () => {
    // keep:1 tail = 8+8 = 16 tokens (> min 10).
    const entries = [
      msg("u1", "user", tokenContent(3)),
      msg("a1", "assistant", tokenContent(3)),
      msg("u2", "user", tokenContent(8)),
      msg("a2", "assistant", tokenContent(8)),
    ];
    const r = resolveSmartKeepUserTurns({
      branchEntries: entries,
      requestedKeepUserTurns: null,
      explicit: false,
      smartKeepTail: true,
      minTokens: 10,
      maxTokens: 100,
    });
    expect(r.keepUserTurns).toBe(1);
    expect(r.smartAdjusted).toBe(false);
  });

  test("keep:1 > max → still keep 1 (minimum tail)", () => {
    // keep:1 tail = 50 tokens (> max 40, > min 10).
    const entries = [
      msg("u1", "user", tokenContent(3)),
      msg("a1", "assistant", tokenContent(3)),
      msg("u2", "user", tokenContent(50)),
      msg("a2", "assistant", tokenContent(50)),
    ];
    const r = resolveSmartKeepUserTurns({
      branchEntries: entries,
      requestedKeepUserTurns: null,
      explicit: false,
      smartKeepTail: true,
      minTokens: 10,
      maxTokens: 40,
    });
    expect(r.keepUserTurns).toBe(1);
    expect(r.smartAdjusted).toBe(false);
  });

  test("stop at compact-all boundary (keep:N falls back to compact-all → null)", () => {
    // 2 user turns. keep:2 → cutIdx<=0 → compactAll → tailTokensForKeep returns null.
    // keep:1 tail = 6 (<= min 10). Next k=2 → null → break, keep 1.
    const entries = [
      msg("u1", "user", tokenContent(3)),
      msg("a1", "assistant", tokenContent(3)),
      msg("u2", "user", tokenContent(3)),
      msg("a2", "assistant", tokenContent(3)),
    ];
    const r = resolveSmartKeepUserTurns({
      branchEntries: entries,
      requestedKeepUserTurns: null,
      explicit: false,
      smartKeepTail: true,
      minTokens: 10,
      maxTokens: 100,
    });
    expect(r.keepUserTurns).toBe(1);
    expect(r.smartAdjusted).toBe(false);
  });

  test("default thresholds (5k/25k): small tail → boost before compact-all boundary", () => {
    // Tiny content: keep:1 tail way below 5k.
    const entries = [
      msg("u1", "user", "hi"),
      msg("a1", "assistant", "hello"),
      msg("u2", "user", "do thing"),
      msg("a2", "assistant", "done"),
      msg("u3", "user", "more"),
      msg("a3", "assistant", "ok"),
    ];
    const r = resolveSmartKeepUserTurns({
      branchEntries: entries,
      requestedKeepUserTurns: null,
      explicit: false,
      smartKeepTail: true,
      // use default thresholds
    });
    // keep:3 would cross the compact-all boundary, so boost only to 2.
    expect(r.keepUserTurns).toBe(2);
    expect(r.smartAdjusted).toBe(true);
    expect(r.fromKeep).toBe(1);
  });

  test("uses calibrated chars/token ratio when estimating tail size", () => {
    const entries = [
      msg("u1", "user", tokenContent(3)),
      msg("a1", "assistant", tokenContent(3)),
      msg("u2", "user", tokenContent(3)),
      msg("a2", "assistant", tokenContent(3)),
      msg("u3", "user", tokenContent(3)),
      msg("a3", "assistant", tokenContent(3)),
    ];
    const r = resolveSmartKeepUserTurns({
      branchEntries: entries,
      requestedKeepUserTurns: null,
      explicit: false,
      smartKeepTail: true,
      minTokens: 10,
      maxTokens: 20,
      charsPerToken: 2,
    });

    // With default 4 chars/token: keep:1 is 6 tokens and keep:2 is 12, so it would boost.
    // Calibrated 2 chars/token makes keep:1 already 12 tokens (> minTokens=10), so it stays at 1.
    expect(r.keepUserTurns).toBe(1);
    expect(r.smartAdjusted).toBe(false);
  });
});
