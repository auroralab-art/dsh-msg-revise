import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
//#region src/shared.ts
/** Same-origin endpoint owned by the host half. */
const REVISE_PATH = "/msg-revise";
const MAX_REQUEST_BODY_BYTES = 65536;
const TRUSTED_HOSTNAMES = /* @__PURE__ */ new Set([
	"localhost",
	"127.0.0.1",
	"[::1]",
	"::1"
]);
//#endregion
//#region src/http.ts
function hostnameOf(hostOrOrigin) {
	if (hostOrOrigin.startsWith("http://") || hostOrOrigin.startsWith("https://")) try {
		return new URL(hostOrOrigin).hostname;
	} catch {
		return;
	}
	if (hostOrOrigin.startsWith("[")) {
		const end = hostOrOrigin.indexOf("]");
		return end >= 0 ? hostOrOrigin.slice(0, end + 1) : void 0;
	}
	return hostOrOrigin.split(":")[0];
}
/**
* CSRF / DNS-rebinding fence for `webServer.register` routes.
* Missing both Origin and Host (non-browser internal) is allowed.
*/
function isTrustedRequest(origin, host) {
	if (origin !== void 0 && origin.length > 0) {
		let url;
		try {
			url = new URL(origin);
		} catch {
			return false;
		}
		if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		return TRUSTED_HOSTNAMES.has(url.hostname);
	}
	if (host === void 0 || host.length === 0) return true;
	const hostname = hostnameOf(host);
	return hostname !== void 0 && TRUSTED_HOSTNAMES.has(hostname);
}
var BodyTooLargeError = class extends Error {
	constructor() {
		super(`请求体超过 ${MAX_REQUEST_BODY_BYTES} 字节上限。`);
		this.name = "BodyTooLargeError";
	}
};
function decodeEdit(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("请求体必须是 JSON 对象。");
	const record = value;
	if (record["action"] !== "edit") throw new TypeError("action 必须是 edit。");
	if (typeof record["sessionId"] !== "string" || record["sessionId"].length === 0) throw new TypeError("sessionId 必须是非空字符串。");
	if (!Number.isSafeInteger(record["eventSeq"]) || record["eventSeq"] < 0) throw new TypeError("eventSeq 必须是非负安全整数。");
	if (!Number.isSafeInteger(record["blockIndex"]) || record["blockIndex"] < 0) throw new TypeError("blockIndex 必须是非负安全整数。");
	if (typeof record["text"] !== "string") throw new TypeError("text 必须是字符串。");
	if (record["text"].trim().length === 0) throw new TypeError("text 不能为空。");
	return {
		action: "edit",
		sessionId: record["sessionId"],
		eventSeq: record["eventSeq"],
		blockIndex: record["blockIndex"],
		text: record["text"]
	};
}
//#endregion
//#region src/store.ts
function storePath(home = process.env.DSH_HOME ?? process.cwd()) {
	return join(home, "storages", "dsh-msg-revise", "versions.json");
}
function loadStore(path = storePath()) {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		return parsed;
	} catch {
		return {};
	}
}
function saveStore(store, path = storePath()) {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(store, null, 2));
	renameSync(tmp, path);
}
function rememberVersion(childId, version, path = storePath()) {
	const store = loadStore(path);
	store[childId] = version;
	saveStore(store, path);
}
//#endregion
//#region src/turns.ts
function pairVersion(sourceSessionId, before, after, turn, eventSeq, blockIndex) {
	return {
		effect: {
			id: crypto.randomUUID(),
			operation: "edit",
			cascade: "truncate",
			targetTurn: turn,
			targetEventSeq: eventSeq,
			targetBlockIndex: blockIndex,
			blockKind: "user",
			before,
			after
		},
		inverseSessionId: sourceSessionId,
		time: Date.now()
	};
}
function textBlock(event, blockIndex) {
	const block = event.data.content?.[blockIndex];
	if (block?.type !== "text" || typeof block.text !== "string") throw new Error("所选用户消息块不是文本。");
	return block.text;
}
function replaceText(event, blockIndex, text) {
	return { content: (event.data.content ?? []).map((block, index) => {
		if (index !== blockIndex) return { ...block };
		return {
			...block,
			type: "text",
			text
		};
	}) };
}
/** Fold complete turn brackets plus the optional still-open tail. */
function foldTurns(events) {
	const closed = [];
	let current;
	for (const event of events) {
		if (event.type === "turn/start") {
			current = {
				turn: Number(event.data.turn),
				startSeq: event.seq
			};
			continue;
		}
		if (current === void 0) continue;
		if (event.type === "user/message" && current.user === void 0 && event.data.source?.kind === "user") {
			current.user = event;
			continue;
		}
		if (event.type === "turn/end" && event.data.turn === current.turn) {
			closed.push({
				...current,
				endSeq: event.seq
			});
			current = void 0;
		}
	}
	if (current !== void 0 && current.user !== void 0) return {
		closed,
		open: current
	};
	return { closed };
}
function planEdit(operation, events) {
	const { closed, open } = foldTurns(events);
	if (open?.user !== void 0 && open.user.seq === operation.eventSeq) {
		const before = textBlock(open.user, operation.blockIndex);
		return {
			boundary: open.startSeq - 1,
			version: pairVersion(operation.sessionId, before, operation.text, open.turn, open.user.seq, operation.blockIndex),
			queuedUsers: [replaceText(open.user, operation.blockIndex, operation.text)]
		};
	}
	const turn = closed.find((candidate) => operation.eventSeq > candidate.startSeq && operation.eventSeq < candidate.endSeq);
	if (turn?.user === void 0 || turn.user.seq !== operation.eventSeq) throw new Error("所选消息不属于可修改的用户回合。");
	const before = textBlock(turn.user, operation.blockIndex);
	return {
		boundary: turn.startSeq - 1,
		version: pairVersion(operation.sessionId, before, operation.text, turn.turn, turn.user.seq, operation.blockIndex),
		queuedUsers: [replaceText(turn.user, operation.blockIndex, operation.text)]
	};
}
//#endregion
//#region src/host.ts
const name = "msg-revise";
const inject = [
	"sessions",
	"agents",
	"sessionQuery",
	"workspaceRegistry",
	"webServer"
];
function headerValue(request, name) {
	const headers = request.headers;
	if (headers === void 0) return void 0;
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(value)) return value[0];
	return value;
}
function asFoldEvents(events) {
	return events.map((event) => ({
		type: event.type,
		seq: event.seq,
		time: event.time,
		data: event.data
	}));
}
function cloneQueuedUser(content) {
	return Object.freeze({
		id: crypto.randomUUID(),
		role: "user",
		content: Object.freeze(content),
		source: Object.freeze({ kind: "user" })
	});
}
function agentOptions(events, fallback) {
	const config = events.findLast((event) => event.type === "request/header")?.data.header.config;
	const provider = config?.provider ?? fallback?.provider;
	const model = config?.model ?? fallback?.model;
	if (provider === void 0 || provider.length === 0 || model === void 0 || model.length === 0) throw new Error("无法从会话历史解析模型路由。");
	const maxTokens = config?.maxTokens ?? fallback?.maxTokens;
	return {
		provider,
		model,
		...maxTokens === void 0 ? {} : { maxTokens }
	};
}
async function settleSource(agent) {
	agent.cancel({ kind: "user" }, { keepInbox: false });
	await agent.whenIdle();
}
async function withSourceAgent(ctx, sessionId, operation) {
	let handle;
	let agent = ctx.agents.get(sessionId);
	if (agent === void 0) {
		const snapshot = await ctx.sessionQuery.readSession(sessionId);
		handle = await ctx.agents.resume({
			resumeSessionId: sessionId,
			agentOptions: agentOptions(snapshot.events)
		});
		agent = handle.agent;
	}
	try {
		await settleSource(agent);
		return await agent.runMaintenance(async () => operation(agent));
	} finally {
		await handle?.dispose();
	}
}
function inheritedSeed(source, boundary) {
	if (boundary === -1) return [];
	const boundaryEvent = source.events[boundary];
	if (boundary < 0 || boundaryEvent === void 0 || boundaryEvent.seq !== boundary) throw new Error("分支边界不是连续会话事件。");
	return source.events.slice(0, boundary + 1);
}
function sessionPreset(session) {
	const header = session.header;
	if (header.agentPreset !== void 0) return header.agentPreset;
	for (let index = session.events.length - 1; index >= 0; index -= 1) {
		const event = session.events[index];
		if (event?.type === "agent-preset/selected" && event.data?.agentPreset !== void 0) return event.data.agentPreset;
	}
}
async function createVersionAgent(ctx, source, childId, seed, options) {
	const presets = ctx.get("agentPresets");
	const presetId = sessionPreset(source);
	let agentPreset;
	let setup;
	if (presets !== void 0 && presetId !== void 0) {
		const resolved = (await presets.resolve(presetId)).id;
		agentPreset = resolved;
		setup = async (agentCtx) => {
			await presets.mount(agentCtx, resolved);
		};
	}
	const child = await ctx.agents.create({
		sessionId: childId,
		seed,
		meta: {
			...source.header.cwd === void 0 ? {} : { cwd: source.header.cwd },
			parentSession: source.id,
			seedLength: seed.length,
			...agentPreset === void 0 ? {} : { agentPreset }
		},
		agentOptions: options,
		...setup === void 0 ? {} : { setup }
	});
	try {
		await ctx.sessions.flush(child.agent.session);
		return child;
	} catch (error) {
		await child.dispose();
		throw error;
	}
}
function sourceWorkspace(ctx, sessionId) {
	return ctx.workspaceRegistry.list().find((workspace) => workspace.sessionIds.includes(sessionId));
}
async function recoverOperation(inverses) {
	const failures = [];
	for (const inverse of inverses.reverse()) try {
		await inverse();
	} catch (error) {
		failures.push(error);
	}
	if (failures.length > 0) throw new AggregateError(failures, "修改操作恢复失败。");
}
async function inheritTitle(ctx, sourceId, childSession) {
	const sessionTitle = ctx.get("sessionTitle");
	if (sessionTitle === void 0) return;
	const snapshot = await ctx.sessionQuery.readTitle(sourceId);
	if (snapshot?.title != null && snapshot.title.trim().length > 0) sessionTitle.rename(childSession, snapshot.title);
}
async function finalizeEdit(ctx, sourceId, childId) {
	try {
		const childSession = ctx.agents.get(childId)?.session;
		if (childSession !== void 0) await inheritTitle(ctx, sourceId, childSession);
	} catch (error) {
		ctx.logger.warn("msg-revise: inherit title failed: " + (error instanceof Error ? error.message : String(error)));
	}
	try {
		await ctx.workspaceRegistry.archiveSession(sourceId);
	} catch (error) {
		ctx.logger.warn("msg-revise: archive source failed: " + (error instanceof Error ? error.message : String(error)));
	}
}
async function runEdit(ctx, sessionId, eventSeq, blockIndex, text) {
	const sourceId = sessionId;
	return withSourceAgent(ctx, sourceId, async (source) => {
		const childId = "session-" + crypto.randomUUID();
		const inverses = [];
		try {
			const events = source.session.events;
			const plan = planEdit({
				action: "edit",
				sessionId,
				eventSeq,
				blockIndex,
				text
			}, asFoldEvents(events));
			const options = agentOptions(events, source.options);
			const seed = inheritedSeed(source.session, plan.boundary);
			const child = await createVersionAgent(ctx, source.session, childId, seed, options);
			inverses.push(() => child.dispose());
			const workspace = sourceWorkspace(ctx, sourceId);
			if (workspace !== void 0) {
				await workspace.attachSession(childId);
				inverses.push(() => workspace.detachSession(childId));
			}
			for (const queued of plan.queuedUsers) child.agent.followup(cloneQueuedUser(queued.content));
			rememberVersion(childId, plan.version);
			inverses.length = 0;
			return {
				sessionId: childId,
				queuedTurns: plan.queuedUsers.length
			};
		} catch (error) {
			try {
				await recoverOperation(inverses);
			} catch (recoveryError) {
				throw new AggregateError([error, recoveryError], "修改操作及其恢复均失败。");
			}
			throw error;
		}
	});
}
function readJsonBody(request) {
	return new Promise((resolve, reject) => {
		const contentLength = Number(headerValue(request, "content-length") ?? "0");
		if (Number.isFinite(contentLength) && contentLength > 65536) {
			reject(new BodyTooLargeError());
			return;
		}
		const chunks = [];
		let total = 0;
		request.on("data", (chunk) => {
			const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
			total += bytes.length;
			if (total > 65536) {
				reject(new BodyTooLargeError());
				request.destroy?.();
				return;
			}
			chunks.push(bytes);
		});
		request.on("end", () => {
			try {
				const decoder = new TextDecoder();
				let text = "";
				for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
				text += decoder.decode();
				resolve(text.length === 0 ? {} : JSON.parse(text));
			} catch (error) {
				reject(error);
			}
		});
		request.on("error", reject);
	});
}
function respondJson(response, status, value) {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	response.end(JSON.stringify(value));
}
async function handleRoute(ctx, request, response) {
	try {
		if (!isTrustedRequest(headerValue(request, "origin"), headerValue(request, "host"))) {
			respondJson(response, 403, { error: "拒绝跨源请求。" });
			return;
		}
		if (request.method !== "POST") {
			response.writeHead(405);
			response.end();
			return;
		}
		const contentType = headerValue(request, "content-type") ?? "";
		if (request.headers !== void 0 && !contentType.toLowerCase().includes("application/json")) {
			respondJson(response, 415, { error: "content-type 必须是 application/json。" });
			return;
		}
		const operation = decodeEdit(await readJsonBody(request));
		const result = await runEdit(ctx, operation.sessionId, operation.eventSeq, operation.blockIndex, operation.text);
		finalizeEdit(ctx, operation.sessionId, result.sessionId);
		respondJson(response, 200, result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		respondJson(response, error instanceof TypeError || error instanceof BodyTooLargeError ? 400 : 409, { error: message });
	}
}
function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: REVISE_PATH,
		handler: (request, response) => handleRoute(ctx, request, response)
	}), "msg-revise: HTTP route");
}
//#endregion
export { apply, inject, name };
