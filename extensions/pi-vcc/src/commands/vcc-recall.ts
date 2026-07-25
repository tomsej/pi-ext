import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadAllMessages } from "../core/load-messages";
import { searchEntries } from "../core/search-entries";
import { formatRecallOutput } from "../core/format-recall";
import { getActiveLineageEntryIds } from "../core/lineage";
import { parseRecallScope } from "../core/recall-scope";

const PAGE_SIZE = 5;
const DEFAULT_RECENT = 25;

export const registerVccRecallCommand = (pi: ExtensionAPI) => {
  pi.registerCommand("pi-vcc-recall", {
    description: "Search session history. Defaults to active lineage; add scope:all for off-lineage branches.",
    handler: async (args: string, ctx) => {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        ctx.ui.notify("No session file available.", "error");
        return;
      }

      const raw = args.trim();
      const parsed = parseRecallScope(raw);
      const lineageEntryIds = parsed.scope === "lineage"
        ? getActiveLineageEntryIds(ctx.sessionManager)
        : undefined;
      if (!parsed.text) {
        // No query: show recent
        const { rendered } = loadAllMessages(sessionFile, false, lineageEntryIds);
        const recent = rendered.slice(-DEFAULT_RECENT);
        const output = (parsed.scope === "all" ? "Scope: all\n\n" : "") + formatRecallOutput(recent);
        pi.sendMessage({ customType: "vcc-recall", content: output, display: true }, { triggerTurn: true });
        return;
      }

      // Parse page:N from args
      const pageMatch = parsed.text.match(/\bpage:(\d+)\b/i);
      const page = pageMatch ? Math.max(1, parseInt(pageMatch[1], 10)) : 1;
      const query = parsed.text.replace(/\bpage:\d+\b/i, "").trim();

      if (!query) {
        const { rendered } = loadAllMessages(sessionFile, false, lineageEntryIds);
        const recent = rendered.slice(-DEFAULT_RECENT);
        const output = (parsed.scope === "all" ? "Scope: all\n\n" : "") + formatRecallOutput(recent);
        pi.sendMessage({ customType: "vcc-recall", content: output, display: true }, { triggerTurn: true });
        return;
      }

      const { rendered, rawMessages } = loadAllMessages(sessionFile, false, lineageEntryIds);
      const allResults = searchEntries(rendered, rawMessages, query);

      const start = (page - 1) * PAGE_SIZE;
      const pageResults = allResults.slice(start, start + PAGE_SIZE);
      const totalPages = Math.ceil(allResults.length / PAGE_SIZE);
      const scopeSuffix = parsed.scope === "all" ? " (scope: all)" : "";
      const header = totalPages > 1
        ? `Page ${page}/${totalPages} (${allResults.length} total matches${scopeSuffix})`
        : `${allResults.length} matches${scopeSuffix}`;
      const footer = page < totalPages
        ? `\n--- /pi-vcc-recall ${query}${parsed.scope === "all" ? " scope:all" : ""} page:${page + 1} ---`
        : "";
      const output = formatRecallOutput(pageResults, query, header) + footer;
      pi.sendMessage({ customType: "vcc-recall", content: output, display: true }, { triggerTurn: true });
    },
  });
};
