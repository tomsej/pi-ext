import { basename } from "node:path";
import { compile } from "../src/core/summarize";
import { prepareSessionSamples } from "../tests/support/real-sessions";
import { loadSessionMessages } from "../tests/support/load-session";
import { writeFileSync, mkdirSync } from "node:fs";

const outDir = "/tmp/pi-vcc-compare";
const branch = process.argv[2] || "unknown";
mkdirSync(`${outDir}/${branch}`, { recursive: true });

const samples = await prepareSessionSamples(5);
for (const sample of samples) {
  const name = basename(sample.source).slice(0, 30);
  const loaded = loadSessionMessages(sample.copy);
  const summary = compile({ messages: loaded.messages });
  const outFile = `${outDir}/${branch}/${name}.txt`;
  writeFileSync(outFile, summary);
  console.log(`${name} (${loaded.messageCount} msgs) => ${summary.length} chars`);
}
console.log(`\nSaved to ${outDir}/${branch}/`);
