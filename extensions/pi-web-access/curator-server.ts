import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { generateCuratorPage } from "./curator-page.js";

const STALE_THRESHOLD_MS = 30000;
const WATCHDOG_INTERVAL_MS = 5000;
const MAX_BODY_SIZE = 64 * 1024;

type ServerState = "SEARCHING" | "RESULT_SELECTION" | "COMPLETED";

export interface CuratorServerOptions {
	queries: string[];
	sessionToken: string;
	timeout: number;
	availableProviders: { perplexity: boolean; gemini: boolean };
	defaultProvider: string;
}

export interface CuratorServerCallbacks {
	onSubmit: (selectedQueryIndices: number[]) => void;
	onCancel: (reason: "user" | "timeout" | "stale") => void;
	onProviderChange: (provider: string) => void;
	onAddSearch: (query: string, queryIndex: number) => Promise<{ answer: string; results: Array<{ title: string; url: string; domain: string }> }>;
}

export interface CuratorServerHandle {
	server: http.Server;
	url: string;
	close: () => void;
	pushResult: (queryIndex: number, data: { answer: string; results: Array<{ title: string; url: string; domain: string }> }) => void;
	pushError: (queryIndex: number, error: string) => void;
	searchesDone: () => void;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
	});
	res.end(JSON.stringify(payload));
}

function parseJSONBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let body = "";
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_SIZE) {
				req.destroy();
				reject(new Error("Request body too large"));
				return;
			}
			body += chunk.toString();
		});
		req.on("end", () => {
			try { resolve(JSON.parse(body)); }
			catch { reject(new Error("Invalid JSON")); }
		});
		req.on("error", reject);
	});
}

export function startCuratorServer(
	options: CuratorServerOptions,
	callbacks: CuratorServerCallbacks,
): Promise<CuratorServerHandle> {
	const { queries, sessionToken, timeout, availableProviders, defaultProvider } = options;
	let browserConnected = false;
	let lastHeartbeatAt = Date.now();
	let completed = false;
	let watchdog: NodeJS.Timeout | null = null;
	let state: ServerState = "SEARCHING";
	let sseResponse: ServerResponse | null = null;
	const sseBuffer: string[] = [];
	let nextQueryIndex = queries.length;

	let sseKeepalive: NodeJS.Timeout | null = null;

	const markCompleted = (): boolean => {
		if (completed) return false;
		completed = true;
		state = "COMPLETED";
		if (watchdog) { clearInterval(watchdog); watchdog = null; }
		if (sseKeepalive) { clearInterval(sseKeepalive); sseKeepalive = null; }
		if (sseResponse) {
			try { sseResponse.end(); } catch {}
			sseResponse = null;
		}
		return true;
	};

	const touchHeartbeat = (): void => {
		lastHeartbeatAt = Date.now();
		browserConnected = true;
	};

	function validateToken(body: unknown, res: ServerResponse): boolean {
		if (!body || typeof body !== "object") {
			sendJson(res, 400, { ok: false, error: "Invalid body" });
			return false;
		}
		if ((body as { token?: string }).token !== sessionToken) {
			sendJson(res, 403, { ok: false, error: "Invalid session" });
			return false;
		}
		return true;
	}

	function sendSSE(event: string, data: unknown): void {
		const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		const res = sseResponse;
		if (res && !res.writableEnded && res.socket && !res.socket.destroyed) {
			try {
				const ok = res.write(payload);
				if (!ok) res.once("drain", () => {});
			} catch {
				sseBuffer.push(payload);
			}
		} else {
			sseBuffer.push(payload);
		}
	}

	const pageHtml = generateCuratorPage(queries, sessionToken, timeout, availableProviders, defaultProvider);

	const server = http.createServer(async (req, res) => {
		try {
			const method = req.method || "GET";
			const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

			if (method === "GET" && url.pathname === "/") {
				const token = url.searchParams.get("session");
				if (token !== sessionToken) {
					res.writeHead(403, { "Content-Type": "text/plain" });
					res.end("Invalid session");
					return;
				}
				touchHeartbeat();
				res.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store",
				});
				res.end(pageHtml);
				return;
			}

			if (method === "GET" && url.pathname === "/events") {
				const token = url.searchParams.get("session");
				if (token !== sessionToken) {
					res.writeHead(403, { "Content-Type": "text/plain" });
					res.end("Invalid session");
					return;
				}
				if (state === "COMPLETED") {
					sendJson(res, 409, { ok: false, error: "No events available" });
					return;
				}
				if (sseResponse) {
					try { sseResponse.end(); } catch {}
				}
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"Connection": "keep-alive",
					"X-Accel-Buffering": "no",
				});
				res.flushHeaders();
				if (res.socket) res.socket.setNoDelay(true);
				sseResponse = res;
				for (const msg of sseBuffer) {
					try { res.write(msg); } catch {}
				}
				sseBuffer.length = 0;
				if (sseKeepalive) clearInterval(sseKeepalive);
				sseKeepalive = setInterval(() => {
					if (sseResponse) {
						try { sseResponse.write(":keepalive\n\n"); } catch {}
					}
				}, 15000);
				req.on("close", () => {
					if (sseResponse === res) sseResponse = null;
				});
				return;
			}

			if (method === "POST" && url.pathname === "/heartbeat") {
				const body = await parseJSONBody(req).catch(() => null);
				if (!body) { sendJson(res, 400, { ok: false, error: "Invalid body" }); return; }
				if (!validateToken(body, res)) return;
				touchHeartbeat();
				sendJson(res, 200, { ok: true });
				return;
			}

			if (method === "POST" && url.pathname === "/provider") {
				const body = await parseJSONBody(req).catch(() => null);
				if (!body) { sendJson(res, 400, { ok: false, error: "Invalid body" }); return; }
				if (!validateToken(body, res)) return;
				const { provider } = body as { provider?: string };
				if (typeof provider === "string" && provider.length > 0) {
					setImmediate(() => callbacks.onProviderChange(provider));
				}
				sendJson(res, 200, { ok: true });
				return;
			}

			if (method === "POST" && url.pathname === "/search") {
				const body = await parseJSONBody(req).catch(() => null);
				if (!body) { sendJson(res, 400, { ok: false, error: "Invalid body" }); return; }
				if (!validateToken(body, res)) return;
				if (state === "COMPLETED") {
					sendJson(res, 409, { ok: false, error: "Session closed" });
					return;
				}
				const { query } = body as { query?: string };
				if (typeof query !== "string" || query.trim().length === 0) {
					sendJson(res, 400, { ok: false, error: "Invalid query" });
					return;
				}
				const qi = nextQueryIndex++;
				touchHeartbeat();
				try {
					const result = await callbacks.onAddSearch(query.trim(), qi);
					sendJson(res, 200, { ok: true, queryIndex: qi, answer: result.answer, results: result.results });
				} catch (err) {
					const message = err instanceof Error ? err.message : "Search failed";
					sendJson(res, 200, { ok: true, queryIndex: qi, error: message });
				}
				return;
			}

			if (method === "POST" && url.pathname === "/submit") {
				const body = await parseJSONBody(req).catch(() => null);
				if (!body) { sendJson(res, 400, { ok: false, error: "Invalid body" }); return; }
				if (!validateToken(body, res)) return;
				const { selected } = body as { selected?: number[] };
				if (!Array.isArray(selected) || !selected.every(n => typeof n === "number")) {
					sendJson(res, 400, { ok: false, error: "Invalid selection" });
					return;
				}
				if (state !== "SEARCHING" && state !== "RESULT_SELECTION") {
					sendJson(res, 409, { ok: false, error: "Cannot submit in current state" });
					return;
				}
				if (!markCompleted()) {
					sendJson(res, 409, { ok: false, error: "Session closed" });
					return;
				}
				sendJson(res, 200, { ok: true });
				setImmediate(() => callbacks.onSubmit(selected));
				return;
			}

			if (method === "POST" && url.pathname === "/cancel") {
				const body = await parseJSONBody(req).catch(() => null);
				if (!body) { sendJson(res, 400, { ok: false, error: "Invalid body" }); return; }
				if (!validateToken(body, res)) return;
				if (!markCompleted()) {
					sendJson(res, 200, { ok: true });
					return;
				}
				const { reason } = body as { reason?: string };
				sendJson(res, 200, { ok: true });
				const cancelReason = reason === "timeout" ? "timeout" : "user";
				setImmediate(() => callbacks.onCancel(cancelReason));
				return;
			}

			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not found");
		} catch (err) {
			const message = err instanceof Error ? err.message : "Server error";
			sendJson(res, 500, { ok: false, error: message });
		}
	});

	return new Promise((resolve, reject) => {
		const onError = (err: Error) => {
			reject(new Error(`Curator server failed to start: ${err.message}`));
		};

		server.once("error", onError);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", onError);
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				reject(new Error("Curator server: invalid address"));
				return;
			}
			const url = `http://localhost:${addr.port}/?session=${sessionToken}`;

			watchdog = setInterval(() => {
				if (completed || !browserConnected) return;
				if (Date.now() - lastHeartbeatAt <= STALE_THRESHOLD_MS) return;
				if (!markCompleted()) return;
				setImmediate(() => callbacks.onCancel("stale"));
			}, WATCHDOG_INTERVAL_MS);

			resolve({
				server,
				url,
				close: () => {
					const wasOpen = markCompleted();
					try { server.close(); } catch {}
					if (wasOpen) {
						setImmediate(() => callbacks.onCancel("stale"));
					}
				},
				pushResult: (queryIndex, data) => {
					if (completed) return;
					sendSSE("result", { queryIndex, query: queries[queryIndex] ?? "", ...data });
				},
				pushError: (queryIndex, error) => {
					if (completed) return;
					sendSSE("search-error", { queryIndex, query: queries[queryIndex] ?? "", error });
				},
				searchesDone: () => {
					if (completed) return;
					sendSSE("done", {});
					state = "RESULT_SELECTION";
				},
			});
		});
	});
}
