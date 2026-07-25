import { describe, expect, test } from "bun:test";
import {
  calibrateCharsPerToken,
  estimateMessageContentChars,
  estimateMessageContentTokens,
  estimateTokensFromChars,
} from "../src/core/token-estimate";

describe("token estimate", () => {
  test("estimates tokens from chars with ceil to avoid undercounting", () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(1)).toBe(1);
    expect(estimateTokensFromChars(4)).toBe(1);
    expect(estimateTokensFromChars(5)).toBe(2);
  });

  test("supports calibrated chars/token ratios", () => {
    expect(estimateTokensFromChars(5, 2)).toBe(3);
    expect(estimateMessageContentTokens("abcde", 2)).toBe(3);
  });

  test("calibrates chars/token from source chars and tokens", () => {
    expect(calibrateCharsPerToken(120, 40)).toMatchObject({
      mode: "calibrated",
      charsPerToken: 3,
      sourceChars: 120,
      sourceTokens: 40,
      rawCharsPerToken: 3,
    });
  });

  test("clamps calibrated ratios and falls back without usable source tokens", () => {
    expect(calibrateCharsPerToken(10, 100).charsPerToken).toBe(2);
    expect(calibrateCharsPerToken(1000, 10).charsPerToken).toBe(6);
    expect(calibrateCharsPerToken(1000, 0)).toMatchObject({
      mode: "heuristic",
      charsPerToken: 4,
    });
  });

  test("estimates message content chars from strings and content parts", () => {
    expect(estimateMessageContentChars("hello")).toBe(5);
    expect(estimateMessageContentChars([
      { type: "text", text: "hello" },
      { type: "toolCall", name: "read", input: { path: "a.ts" } },
      { type: "toolResult", content: "done" },
      { type: "image", mimeType: "image/png" },
    ])).toBe(5 + 4 + JSON.stringify({ path: "a.ts" }).length + 4 + 4800);
  });

  test("counts real Pi part shapes: thinking text and toolCall arguments", () => {
    // Pi assistant content: thinking.thinking + toolCall.arguments (not .input).
    expect(estimateMessageContentChars([
      { type: "thinking", thinking: "reasoning", thinkingSignature: "sig" },
      { type: "text", text: "answer" },
      { type: "toolCall", name: "bash", arguments: { command: "ls" } },
    ])).toBe(9 + 6 + 4 + JSON.stringify({ command: "ls" }).length);
  });

  test("ignores non-token parts and unknown shapes without throwing", () => {
    expect(estimateMessageContentChars([
      { type: "thinking" },              // missing thinking field → 0
      { type: "toolCall", name: "noop" }, // name(4) + stringify("")=('""'=2) → 6
      { type: "mystery", text: "x" },     // unknown → falls back to text → 1
      null,                               // 0
      "not-an-object",                    // 0
    ] as any)).toBe(0 + 6 + 1 + 0 + 0);
  });

  test("estimates message content tokens through the shared char estimator", () => {
    expect(estimateMessageContentTokens("abcde")).toBe(2);
  });
});
