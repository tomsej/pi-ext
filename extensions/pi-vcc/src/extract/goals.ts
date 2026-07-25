import type { NormalizedBlock } from "../types";
import { nonEmptyLines, clip } from "../core/content";
import { collapseSkillLines } from "../core/skill-collapse";
import { fold } from "../core/fold";

const SCOPE_CHANGE_RE =
  /\b(instead|actually|change of plan|forget that|new task|switch to|now I want|pivot|let'?s do|stop .* and)\b/i;

const TASK_RE =
  /\b(fix|implement|add|create|build|refactor|debug|investigate|update|remove|delete|migrate|deploy|test|write|set up)\b/i;

const NOISE_SHORT_RE = /^(ok|yes|no|sure|yeah|yep|go|hi|hey|thx|thanks|ok\b.*|y|n|k)\s*[.!?]*$/i;

// ── Czech patterns (tested against diacritics-folded text) ──

const SCOPE_CHANGE_CS_RE =
  /\b(misto toho|vlastne|zapomen|novy (task|ukol)|prepni (na|se)|ted (chci|prosim)|pojdme|radeji|zmena planu|jinak to|nakonec)\b/;

const TASK_CS_RE =
  /\b(udel\w*|uprav\w*|oprav\w*|prid\w*|vytvor\w*|smaz\w*|odstran\w*|refaktor\w*|implementuj|zkus|projdi|over\w*|zjisti|nastav\w*|otestuj|napis|spust|prepis|presun|dopln\w*|nahrad\w*|vyres|zkontroluj|pouzij|rozdel|zapni|vypni|dej pryc)\b/;

// Bare acknowledgements: "ano", "jo diky", "tak jo, dobre", "pokracuj" …
const NOISE_SHORT_CS_RE =
  /^(tak\s+)?(ano|ne|jo|jojo|oki|dobre|jasne|super|paradni?|diky|dik|dekuju|dekuji|prosim|presne|souhlas|hotovo|pokracuj|nevim|muzes|jdeme|super\s+diky)([\s,]+(prosim|diky|dik|jo|ano|dobre|jasne|super|hotovo))*\s*[.!?…]*$/;

// Reject lines that are clearly not user goals (pasted output, code, paths, tool dumps)
// or meta-prompt boilerplate (command templates like `/issues` that start with "For each issue:"
// followed by numbered "Read the issue in full..." steps).
const NON_GOAL_RE =
  /^\s*[\[│├└─╭╰]|```|^\s*(=[A-Z]+\(|function |const |let |var |import |export |class )|^(https?:|file:|\/[A-Za-z])|\\n|^\s*For each\b|\bin full\b[^\n]*\b(comments|issue|issues|PRs?|linked)\b/;

// Signals that the rest of the user message is a command template (e.g. /issues),
// in which case we should stop collecting goals at the signal line.
const TEMPLATE_SIGNAL_RE =
  /^\s*(For each\b|Do NOT implement\b|Analyze and propose\b|If Task\/context\b|Output:\s*$)/i;

const truncateAtTemplate = (lines: string[]): string[] => {
  const idx = lines.findIndex((l) => TEMPLATE_SIGNAL_RE.test(l));
  return idx >= 0 ? lines.slice(0, idx) : lines;
};

const stripLeadingBullet = (line: string): string =>
  line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim();

const MAX_GOAL_CHARS = 200;

const isSubstantiveGoal = (text: string): boolean => {
  const t = text.trim();
  if (t.length <= 5) return false;
  if (t.length > MAX_GOAL_CHARS) return false;
  if (NOISE_SHORT_RE.test(t)) return false;
  if (NOISE_SHORT_CS_RE.test(fold(t))) return false;
  if (NON_GOAL_RE.test(t)) return false;
  return true;
};

// Test scope-change / task intent only on the leading portion of a user block
// so that pasted outputs below the actual instruction do not trigger matches.
const LEADING_CHARS = 200;

export const extractGoals = (blocks: NormalizedBlock[]): string[] => {
  const goals: string[] = [];
  let latestScopeChange: string[] | null = null;

  for (const b of blocks) {
    if (b.kind !== "user") continue;
    const rawLines = nonEmptyLines(b.text);
    const truncated = truncateAtTemplate(rawLines);
    const lines = collapseSkillLines(truncated.filter(isSubstantiveGoal))
      .map(stripLeadingBullet)
      .filter((l) => l.length > 5);
    if (lines.length === 0) continue;

    if (goals.length === 0) {
      goals.push(...lines.slice(0, 6));
      continue;
    }

    const leading = b.text.slice(0, LEADING_CHARS);
    const leadingFolded = fold(leading);
    if (SCOPE_CHANGE_RE.test(leading) || SCOPE_CHANGE_CS_RE.test(leadingFolded)) {
      latestScopeChange = lines.slice(0, 3).map((l) => clip(l, MAX_GOAL_CHARS));
    } else if ((TASK_RE.test(leading) || TASK_CS_RE.test(leadingFolded)) && lines[0].length > 15) {
      latestScopeChange = lines.slice(0, 2).map((l) => clip(l, MAX_GOAL_CHARS));
    }
  }

  // Only emit the [Scope change] marker when we actually captured bullets.
  if (latestScopeChange && latestScopeChange.length > 0) {
    goals.push("[Scope change]", ...latestScopeChange);
  }

  return goals.slice(0, 8);
};
