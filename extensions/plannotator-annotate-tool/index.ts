/**
 * plannotator_annotate tool — lets the agent open a markdown file in the
 * Plannotator annotation browser UI and wait for the user's decision.
 *
 * Used for manual QA/UAT handoff: the agent generates qa.md, then calls this
 * tool; the user walks through the checklist in the browser, annotates
 * failures, and hits Approve or submits feedback. The result comes back as the
 * tool result, so the agent can react (fix code, update qa.md, resubmit).
 *
 * Talks to the Plannotator extension over its public event-bus API
 * (plannotator:request channel), so it works without patching the package.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const PLANNOTATOR_REQUEST_CHANNEL = "plannotator:request";
const PING_TIMEOUT_MS = 3_000;

interface AnnotationResult {
	feedback: string;
	exit?: boolean;
	approved?: boolean;
}

interface PlannotatorResponse {
	status: "handled" | "unavailable" | "error";
	result?: AnnotationResult;
	error?: string;
}

function request(pi: ExtensionAPI, action: string, payload: unknown, timeoutMs?: number): Promise<PlannotatorResponse | null> {
	return new Promise((resolvePromise) => {
		let settled = false;
		const settle = (res: PlannotatorResponse | null) => {
			if (settled) return;
			settled = true;
			resolvePromise(res);
		};
		if (timeoutMs) setTimeout(() => settle(null), timeoutMs);
		pi.events.emit(PLANNOTATOR_REQUEST_CHANNEL, {
			requestId: crypto.randomUUID(),
			action,
			payload,
			respond: settle,
		});
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "plannotator_annotate",
		label: "Plannotator Annotate",
		description:
			"Open a markdown file in the Plannotator annotation browser UI and wait for the user's review. " +
			"The user can annotate the document and either Approve it or submit feedback. " +
			"Returns the decision: approved, or the user's annotations as feedback. " +
			"Use this for manual QA handoff (e.g. a generated qa.md checklist) — call it instead of asking the user to run /plannotator-annotate. " +
			"Blocks until the user decides, which may take a while — that is expected.",
		parameters: Type.Object({
			filePath: Type.String({
				description: "Path to the markdown file to annotate, relative to the working directory.",
			}),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const absolutePath = resolve(ctx.cwd, params.filePath);
			let markdown: string;
			try {
				markdown = readFileSync(absolutePath, "utf8");
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error: cannot read ${absolutePath}: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
					details: undefined,
				};
			}

			// Handshake: review-status answers immediately even before a session
			// is fully ready, so a missing/broken Plannotator fails fast instead
			// of hanging the annotate request forever.
			const ping = await request(pi, "review-status", { reviewId: "plannotator-annotate-tool-ping" }, PING_TIMEOUT_MS);
			if (!ping) {
				return {
					content: [{ type: "text", text: `Plannotator extension not responding (not installed?). Ask the user to run /plannotator-annotate ${params.filePath} manually.` }],
					isError: true,
					details: undefined,
				};
			}

			// The annotate request resolves only after the user decides in the
			// browser — no timeout, but honor cancellation of the tool call.
			const response = await Promise.race([
				request(pi, "annotate", { filePath: absolutePath, markdown, mode: "annotate", gate: true }),
				new Promise<null>((resolvePromise) => signal?.addEventListener("abort", () => resolvePromise(null), { once: true })),
			]);

			if (!response) {
				return { content: [{ type: "text", text: "Annotation review cancelled." }], isError: true, details: undefined };
			}
			if (response.status !== "handled" || !response.result) {
				return {
					content: [{ type: "text", text: `Plannotator annotate failed: ${response.error ?? response.status}. Ask the user to run /plannotator-annotate ${params.filePath} manually.` }],
					isError: true,
					details: undefined,
				};
			}

			const { approved, exit, feedback } = response.result;
			const text = approved
				? "User APPROVED the document. QA passed."
				: exit
					? "User closed the review without feedback. Ask how to proceed."
					: `User submitted annotations (not approved). Address this feedback:\n\n${feedback}`;
			return {
				content: [{ type: "text", text }],
				details: response.result,
			};
		},
	});
}
