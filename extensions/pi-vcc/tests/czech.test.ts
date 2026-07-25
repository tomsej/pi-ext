import { describe, it, expect } from "bun:test";
import { extractGoals } from "../src/extract/goals";
import { extractPreferences } from "../src/extract/preferences";
import type { NormalizedBlock } from "../src/types";

const user = (text: string): NormalizedBlock =>
  ({ kind: "user", text, index: 0 }) as unknown as NormalizedBlock;

describe("czech goal extraction", () => {
  it("drops czech acknowledgements instead of treating them as the goal", () => {
    expect(extractGoals([user("ano prosim")])).toEqual([]);
    expect(extractGoals([user("jo díky")])).toEqual([]);
    expect(extractGoals([user("tak jo, dobře")])).toEqual([]);
  });

  it("keeps a czech acknowledgement that carries an actual instruction", () => {
    expect(extractGoals([user("ano prosim udelej obe varianty")])).toEqual([
      "ano prosim udelej obe varianty",
    ]);
  });

  it("detects a czech task instruction as a scope change", () => {
    const goals = extractGoals([
      user("nastav dark mode v editoru"),
      user("teď prosím refaktoruj extension loader do vlastního modulu"),
    ]);
    expect(goals).toContain("[Scope change]");
    expect(goals.some((g) => g.includes("refaktoruj extension loader"))).toBe(true);
  });

  it("detects czech scope-change phrasing", () => {
    const goals = extractGoals([
      user("nastav dark mode v editoru"),
      user("misto toho pojdme resit rychlost startu"),
    ]);
    expect(goals).toContain("[Scope change]");
  });
});

describe("czech preference extraction", () => {
  it("picks up czech always/never rules with and without diacritics", () => {
    expect(extractPreferences([user("vždy piš commity anglicky")])).toEqual([
      "vždy piš commity anglicky",
    ]);
    expect(extractPreferences([user("nikdy nepushuj do main")])).toEqual([
      "nikdy nepushuj do main",
    ]);
    expect(extractPreferences([user("nechci zadne nove dependencies")])).toEqual([
      "nechci zadne nove dependencies",
    ]);
  });

  it("picks up a czech language preference", () => {
    expect(extractPreferences([user("mluv se mnou česky, kód piš anglicky")])).toEqual([
      "mluv se mnou česky, kód piš anglicky",
    ]);
  });

  it("still ignores czech questions", () => {
    expect(extractPreferences([user("vždy to pushuješ do main?")])).toEqual([]);
  });
});
