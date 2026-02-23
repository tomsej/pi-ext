import { complete, type Context } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SearchResult } from "./perplexity.js";
import type { QueryResultData } from "./storage.js";

const DEFAULT_PROMPT = `You are a research assistant. You receive search results from multiple queries and produce a concise, deduplicated briefing.

Rules:
1. Skip any query results that are clearly irrelevant or off-topic
2. Organize by topic, not by original query
3. Remove redundant information — if two results cover the same point, include it once with both sources cited
4. Preserve specific facts, numbers, code examples, and recommendations
5. Cite sources inline: "reduced by 18-29% [domain.com]"
6. End with a full source list (domain + title + URL)
7. Be thorough but never redundant`;

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
const TIMEOUT_MS = 15000;
const MAX_TOKENS = 2048;
const SKIP_THRESHOLD_TOKENS = 500;
const REDUNDANT_SIMILARITY_THRESHOLD = 0.7;
const QUALITY_TIERS: [RegExp, string][] = [
	[/\.(gov|edu)$/, "institutional"],
	[/^(docs\.|developer\.)/, "official-docs"],
	[/^github\.com/, "code"],
	[/^(stackoverflow|stackexchange)\.com/, "forum"],
	[/^arxiv\.org/, "paper"],
	[/^news\.ycombinator\.com|^reddit\.com/, "discussion"],
	[/^medium\.com|^dev\.to$|^substack\.com/, "blog-platform"],
];
const QUALITY_LABELS: Record<string, string> = {
	institutional: "institutional sources",
	"official-docs": "official docs",
	code: "code repositories",
	forum: "forum sources",
	paper: "papers",
	discussion: "discussion sources",
	"blog-platform": "blog-platform sources",
	other: "other sources",
};
const CITATION_RE = /\[([a-z0-9.-]+\.[a-z]{2,}(?:,\s*[a-z0-9.-]+\.[a-z]{2,})*)\](?!\()/gi;

export interface CondenseConfig {
	model: string;
	prompt: string;
}

export interface PreprocessedData {
	overlapPairs: Array<{ q1: number; q2: number; shared: number; pct: number }>;
	similarityPairs: Array<{ q1: number; q2: number; similarity: number }>;
	totalTokens: number;
	skipCondensation: boolean;
	qualitySummary: string;
	hints: string;
}

export function resolveCondenseConfig(
	raw: boolean | { enabled?: boolean; model?: string; prompt?: string } | undefined,
): CondenseConfig | null {
	if (raw === false) return null;
	if (raw === true || raw === undefined || raw === null) {
		return { model: DEFAULT_MODEL, prompt: DEFAULT_PROMPT };
	}
	if (raw.enabled === false) return null;
	return {
		model: raw.model || DEFAULT_MODEL,
		prompt: raw.prompt || DEFAULT_PROMPT,
	};
}

function normalizeUrl(url: string): string {
	try {
		const u = new URL(url);
		const host = u.hostname.replace(/^www\./, "").toLowerCase();
		const path = u.pathname.replace(/\/$/, "");
		return `${host}${path}`;
	} catch {
		return url.trim().toLowerCase()
			.replace(/^https?:\/\//, "")
			.replace(/^www\./, "")
			.replace(/[?#].*$/, "")
			.replace(/\/$/, "");
	}
}

function computeOverlapPairs(
	results: Map<number, QueryResultData>,
): Array<{ q1: number; q2: number; shared: number; pct: number }> {
	const urlToQueries = new Map<string, Set<number>>();
	const querySourceCounts = new Map<number, number>();

	for (const [qi, data] of results) {
		querySourceCounts.set(qi, data.results.length);
		for (const r of data.results) {
			const key = normalizeUrl(r.url);
			const set = urlToQueries.get(key) ?? new Set<number>();
			set.add(qi);
			urlToQueries.set(key, set);
		}
	}

	const pairShared = new Map<string, number>();
	const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;

	for (const qis of urlToQueries.values()) {
		if (qis.size < 2) continue;
		const arr = [...qis];
		for (let i = 0; i < arr.length; i++) {
			for (let j = i + 1; j < arr.length; j++) {
				const key = pairKey(arr[i], arr[j]);
				pairShared.set(key, (pairShared.get(key) ?? 0) + 1);
			}
		}
	}

	const pairs: Array<{ q1: number; q2: number; shared: number; pct: number }> = [];
	for (const [key, shared] of pairShared) {
		const [a, b] = key.split("-").map(Number);
		const minSources = Math.max(1, Math.min(querySourceCounts.get(a) ?? 0, querySourceCounts.get(b) ?? 0));
		pairs.push({ q1: a, q2: b, shared, pct: Math.round((shared / minSources) * 100) });
	}

	return pairs;
}

function answerSimilarity(a: string, b: string): number {
	const words = (s: string) =>
		new Set(
			s.toLowerCase()
				.split(/\s+/)
				.filter(w => w.length > 3),
		);

	const setA = words(a);
	const setB = words(b);
	if (setA.size === 0 || setB.size === 0) return 0;
	let intersection = 0;
	for (const word of setA) {
		if (setB.has(word)) intersection++;
	}
	return intersection / Math.max(setA.size, setB.size);
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return normalizeUrl(url).split("/")[0] || normalizeUrl(url);
	}
}

function qualityTierForDomain(domain: string): string {
	for (const [re, tier] of QUALITY_TIERS) {
		if (re.test(domain)) return tier;
	}
	return "other";
}

export function preprocessSearchResults(
	results: Map<number, QueryResultData>,
): PreprocessedData {
	const overlapPairs = computeOverlapPairs(results)
		.sort((a, b) => b.pct - a.pct || b.shared - a.shared);

	const entries = [...results.entries()].sort((a, b) => a[0] - b[0]);
	const similarityPairs: Array<{ q1: number; q2: number; similarity: number }> = [];
	for (let i = 0; i < entries.length; i++) {
		for (let j = i + 1; j < entries.length; j++) {
			const [q1, r1] = entries[i];
			const [q2, r2] = entries[j];
			similarityPairs.push({
				q1,
				q2,
				similarity: answerSimilarity(r1.answer || "", r2.answer || ""),
			});
		}
	}
	similarityPairs.sort((a, b) => b.similarity - a.similarity);

	let totalTokens = 0;
	const qualityCounts = new Map<string, number>();
	for (const data of results.values()) {
		totalTokens += estimateTokens(data.answer || "");
		for (const source of data.results) {
			const tier = qualityTierForDomain(extractDomain(source.url));
			qualityCounts.set(tier, (qualityCounts.get(tier) ?? 0) + 1);
		}
	}
	const skipCondensation = totalTokens < SKIP_THRESHOLD_TOKENS;
	const qualitySummary = [...qualityCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([tier, count]) => `${count} ${QUALITY_LABELS[tier] ?? tier}`)
		.join(", ") || "no sources";

	const overlapLines = overlapPairs.map(p =>
		`- Q${p.q1} and Q${p.q2} share ${p.shared} sources (${p.pct}%)`,
	);
	const similarityLines = similarityPairs
		.filter(p => p.similarity >= REDUNDANT_SIMILARITY_THRESHOLD)
		.map(p => `- Q${p.q1} and Q${p.q2} answers are ${Math.round(p.similarity * 100)}% similar by word overlap`);

	const hints = [
		"Overlap analysis:",
		...(overlapLines.length > 0 ? overlapLines : ["- No source overlap detected across queries."]),
		"",
		"Answer similarity:",
		...(similarityLines.length > 0
			? similarityLines
			: [`- No answer pairs meet the ${Math.round(REDUNDANT_SIMILARITY_THRESHOLD * 100)}% similarity threshold.`]),
		"",
		`Source quality: ${qualitySummary}.`,
		`Estimated answer tokens: ${totalTokens}. ${skipCondensation ? "Below threshold — skip condensation." : "Condensation recommended."}`,
	].join("\n");

	return {
		overlapPairs,
		similarityPairs,
		totalTokens,
		skipCondensation,
		qualitySummary,
		hints,
	};
}

export async function condenseSearchResults(
	results: Map<number, QueryResultData>,
	config: CondenseConfig,
	ctx: ExtensionContext | undefined,
	signal?: AbortSignal,
	taskContext?: string,
	preprocessed?: PreprocessedData,
): Promise<string | null> {
	try {
		if (results.size < 2 || !ctx) return null;

		const slashIndex = config.model.indexOf("/");
		if (slashIndex === -1) return null;
		const provider = config.model.slice(0, slashIndex);
		const modelId = config.model.slice(slashIndex + 1);

		const model = ctx.modelRegistry.find(provider, modelId);
		if (!model) return null;

		const apiKey = await ctx.modelRegistry.getApiKey(model);
		if (!apiKey) return null;

		const queryData = [...results.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([qi, r]) => {
				const sources = r.results.map((s, si) => {
					const domain = extractDomain(s.url);
					const tier = qualityTierForDomain(domain);
					return `${si + 1}. ${s.title}\n   ${s.url}\n   quality: ${tier}`;
				}).join("\n");
				return `[${qi}] Query: "${r.query}"\n` +
					(r.error ? `Error: ${r.error}\n` : "") +
					`Answer:\n${r.answer || "(empty)"}\n` +
					`Sources:\n${sources || "(none)"}`;
			}).join("\n\n");

		let prompt = config.prompt;
		if (taskContext) prompt += `\n\nUser's task: ${taskContext}`;
		if (preprocessed?.hints) prompt += `\n\n${preprocessed.hints}`;
		prompt += `\n\nSearch result data:\n${queryData}`;

		const aiContext: Context = {
			messages: [{
				role: "user",
				content: [{ type: "text", text: prompt }],
				timestamp: Date.now(),
			}],
		};

		const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
		const combinedSignal = signal
			? AbortSignal.any([signal, timeoutSignal])
			: timeoutSignal;

		const response = await complete(model, aiContext, {
			apiKey,
			signal: combinedSignal,
			max_tokens: MAX_TOKENS,
		} as any);
		const text = response.content.find(c => c.type === "text")?.text?.trim();
		if (!text) return null;
		return text;
	} catch {
		return null;
	}
}

function verifyCitations(condensed: string, sources: SearchResult[]): string {
	const knownDomains = new Set(sources.map(s => extractDomain(s.url)));
	return condensed.replace(CITATION_RE, (_match, inner: string) => {
		const domains = inner.split(/,\s*/).map(d => d.trim().toLowerCase());
		const verified = domains.map(d => {
			if (knownDomains.has(d)) return d;
			const closest = [...knownDomains].find(k => k.includes(d) || d.includes(k));
			return closest ?? d;
		});
		return `[${verified.join(", ")}]`;
	});
}

function collectCitedDomains(text: string): string[] {
	const found: string[] = [];
	const seen = new Set<string>();
	const re = new RegExp(CITATION_RE.source, "gi");
	for (const match of text.matchAll(re)) {
		const domains = match[1].split(/,\s*/).map(d => d.trim().toLowerCase());
		for (const domain of domains) {
			if (seen.has(domain)) continue;
			seen.add(domain);
			found.push(domain);
		}
	}
	return found;
}

function sourceLineForDomain(domain: string, sources: SearchResult[]): string {
	const source = sources.find(s => extractDomain(s.url) === domain)
		?? sources.find(s => {
			const d = extractDomain(s.url);
			return d.includes(domain) || domain.includes(d);
		});
	if (!source) return `- ${domain}`;
	const title = source.title?.trim() || source.url;
	return `- ${domain} — ${title} (${source.url})`;
}

function completeSourceList(condensed: string, sources: SearchResult[]): string {
	const withoutSources = condensed.replace(/\n#{2,3}\s+Sources[\s\S]*$/i, "").trimEnd();
	const citedDomains = collectCitedDomains(withoutSources);
	if (citedDomains.length === 0) return withoutSources;
	const sourceLines = citedDomains.map(domain => sourceLineForDomain(domain, sources));
	return `${withoutSources}\n\n## Sources\n${sourceLines.join("\n")}`;
}

export function postProcessCondensed(
	condensed: string,
	sources: SearchResult[],
): string {
	const verified = verifyCitations(condensed, sources);
	const completed = completeSourceList(verified, sources);
	const outputTokens = estimateTokens(completed);
	if (outputTokens > 4000) {
		console.warn(`[pi-web-access] Condensed output length exceeded expected threshold: ~${outputTokens} tokens`);
	}
	return completed.trim();
}
