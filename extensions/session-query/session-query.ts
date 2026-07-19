/**
 * Session Query Extension - Query previous pi sessions
 *
 * Provides a tool the model can use to query past sessions for context,
 * decisions, code changes, or other information.
 *
 * Uses an uncapped VCC summary by default (~9K tokens) which preserves ALL
 * user messages and assistant reasoning. Falls back to full serialized
 * conversation (~80K tokens) via `detailed: true` for queries that need
 * exact file contents or tool output.
 *
 * Standard vccCompile's capBrief(120 lines) loses the first half of longer
 * conversations. This extension bypasses that cap by using vcc's building
 * blocks (normalize → filterNoise → buildSections) directly.
 *
 * Works with handoff: when a handoff prompt includes "Parent session: <path>",
 * the model can use this tool to look up details from that session.
 */

// pi >=0.80: `complete` moved to the compat entrypoint (the root package
// alias resolves to compat at runtime anyway).
import { complete, type Message } from "@mariozechner/pi-ai/compat";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	SessionManager,
	convertToLlm,
	getMarkdownTheme,
	serializeConversation,
	type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { normalize } from "@sting8k/pi-vcc/src/core/normalize";
import { filterNoise } from "@sting8k/pi-vcc/src/core/filter-noise";
import { buildSections } from "@sting8k/pi-vcc/src/core/build-sections";
import { sanitize } from "@sting8k/pi-vcc/src/core/sanitize";

const QUERY_SYSTEM_PROMPT = `You are a session context assistant. Given a session transcript and a question, provide a concise answer based on the session contents.

Focus on:
- Specific decisions, agreements, and the chosen approach
- What was agreed, what was explicitly rejected, what constraints were set
- File paths and code changes mentioned
- Key context the user is asking about

Be concise and direct. If the information isn't in the transcript, say so.
If the question asks about exact file contents, specific error messages, or precise tool output, note that these details may not be in the transcript and suggest retrying with detailed=true.`;

// Cache uncapped summaries per session path.
const summaryCache = new Map<string, string>();

/**
 * Build an uncapped VCC summary: uses vcc's normalize/filterNoise/buildSections
 * but skips capBrief so the full brief transcript is preserved.
 * ~9K tokens vs ~80K for full serialization (8.7x smaller, same accuracy for
 * decisions/agreements, only loses tool result contents).
 */
function buildUncappedSummary(llmMessages: Message[]): string {
	const blocks = filterNoise(normalize(llmMessages));
	const data = buildSections({ blocks });

	const section = (title: string, items: string[]): string => {
		if (items.length === 0) return "";
		return `[${title}]\n${items.map((i) => `- ${i}`).join("\n")}`;
	};

	const headerParts = [
		section("Session Goal", data.sessionGoal),
		section("Files And Changes", data.filesAndChanges),
		section("Outstanding Context", data.outstandingContext),
		section("User Preferences", data.userPreferences),
	].filter(Boolean);

	const parts: string[] = [];
	if (headerParts.length > 0) parts.push(headerParts.join("\n\n"));
	if (data.briefTranscript) parts.push(data.briefTranscript);

	if (parts.length === 0) return "";
	return sanitize(parts.join("\n\n---\n\n"));
}

function getOrBuildSummary(sessionPath: string, llmMessages: Message[]): string {
	const cached = summaryCache.get(sessionPath);
	if (cached) return cached;

	const summary = buildUncappedSummary(llmMessages);
	if (summary) summaryCache.set(sessionPath, summary);
	return summary;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "session_query",
		label: "Session Query",
		description:
			"Query a previous pi session file for context, decisions, or information. Use when you need to look up what happened in a parent session or any other session.",
		renderResult: (result, _options, theme, _ctx) => {
			const container = new Container();
			
			const firstContent = result.content[0];
			if (firstContent && firstContent.type === "text") {
				const text = firstContent.text;
				const match = text.match(/\*\*Query:\*\* (.+?)\n\n---\n\n([\s\S]+)/);
				
				if (match) {
					const [, query, answer] = match;
					container.addChild(new Text(theme.bold("Query: ") + theme.fg("accent", query), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(answer.trim(), 0, 0, getMarkdownTheme(), {
						color: (text: string) => theme.fg("toolOutput", text),
					}));
				} else {
					container.addChild(new Text(theme.fg("toolOutput", text), 0, 0));
				}
			}
			
			return container;
		},
		parameters: Type.Object({
			sessionPath: Type.String({
				description: "Full path to the session file (e.g., /home/user/.pi/agent/sessions/.../session.jsonl)",
			}),
			question: Type.String({
				description: "What you want to know about that session (e.g., 'What files were modified?' or 'What approach was chosen?')",
			}),
			detailed: Type.Optional(Type.Boolean({
				description: "Use full serialized conversation instead of uncapped summary. Set true only when you need exact file contents, specific error messages, or precise tool output that isn't in the transcript. Much slower and more expensive (~80K vs ~9K tokens).",
			})),
		}),

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { sessionPath, question, detailed } = params;

			const errorResult = (text: string) => ({
				content: [{ type: "text" as const, text }],
				details: { error: true },
			});

			if (!sessionPath.endsWith(".jsonl")) {
				return errorResult(`Error: Invalid session path. Expected a .jsonl file, got: ${sessionPath}`);
			}

			try {
				const fs = await import("node:fs");
				if (!fs.existsSync(sessionPath)) {
					return errorResult(`Error: Session file not found: ${sessionPath}`);
				}
			} catch (err) {
				return errorResult(`Error checking session file: ${err}`);
			}

			onUpdate?.({
				content: [{ type: "text", text: `Query${detailed ? " (detailed)" : ""}: ${question}` }],
				details: { status: "loading", question, detailed: !!detailed },
			});

			let sessionManager: SessionManager;
			try {
				sessionManager = SessionManager.open(sessionPath);
			} catch (err) {
				return errorResult(`Error loading session: ${err}`);
			}

			const branch = sessionManager.getBranch();
			const messages = branch
				.filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
				.map((entry) => entry.message);

			if (messages.length === 0) {
				return {
					content: [{ type: "text" as const, text: "Session is empty - no messages found." }],
					details: { empty: true },
				};
			}

			const llmMessages = convertToLlm(messages);

			// Default: uncapped vcc summary (~9K tokens, keeps all user+assistant messages)
			// Detailed: full serialized conversation (~80K tokens, includes tool results)
			let contextText: string;
			let contextLabel: string;
			if (detailed) {
				contextText = serializeConversation(llmMessages);
				contextLabel = "Full Session Conversation";
			} else {
				contextText = getOrBuildSummary(sessionPath, llmMessages);
				contextLabel = "Session Transcript";
				if (!contextText) {
					contextText = serializeConversation(llmMessages);
					contextLabel = "Full Session Conversation";
				}
			}

			// Always use the current session's model — it's available and the user chose it.
			const queryModel = ctx.model;
			if (!queryModel) {
				return errorResult("Error: No model available to analyze the session.");
			}

			try {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(queryModel);
				if (!auth.ok) {
					return errorResult(`Error querying session: ${auth.error}`);
				}

				const userMessage: Message = {
					role: "user",
					content: [
						{
							type: "text",
							text: `## ${contextLabel}\n\n${contextText}\n\n## Question\n\n${question}`,
						},
					],
					timestamp: Date.now(),
				};

				const response = await complete(
					queryModel,
					{ systemPrompt: QUERY_SYSTEM_PROMPT, messages: [userMessage] },
					{
						apiKey: auth.apiKey,
						headers: auth.headers,
						signal,
					},
				);

				if (response.stopReason === "aborted") {
					return {
						content: [{ type: "text" as const, text: "Query was cancelled." }],
						details: { cancelled: true },
					};
				}

				const answer = response.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n");

				return {
					content: [{ type: "text" as const, text: `**Query:** ${question}\n\n---\n\n${answer}` }],
					details: {
						sessionPath,
						question,
						detailed: !!detailed,
						messageCount: messages.length,
					},
				};
			} catch (err) {
				return errorResult(`Error querying session: ${err}`);
			}
		},
	});
}
