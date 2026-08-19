window.__ModuleLoader__.load({
	id: "dsh-msg-revise",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/shared.ts
		/** Same-origin endpoint owned by the host half. */
		const REVISE_PATH = "/msg-revise";
		//#endregion
		//#region src/client/ttft.ts
		function blockText(block) {
			if (typeof block !== "object" || block === null) return void 0;
			const text = block.text;
			return typeof text === "string" ? text : void 0;
		}
		function assistantHasToken(node) {
			if (node.kind !== "assistant") return false;
			if (node.timing?.firstTokenTime != null) return true;
			return node.blocks?.some((block) => (blockText(block)?.length ?? 0) > 0) === true;
		}
		/** TTFT of the turn after the last user node. Prior replies do not count. */
		function snapshotHasFirstToken(snapshot) {
			let lastUser = -1;
			for (let index = 0; index < snapshot.nodes.length; index += 1) if (snapshot.nodes[index]?.kind === "user") lastUser = index;
			for (let index = lastUser + 1; index < snapshot.nodes.length; index += 1) {
				const node = snapshot.nodes[index];
				if (node === void 0) continue;
				if (node.kind === "user") break;
				if (assistantHasToken(node)) return true;
			}
			return snapshot.partial?.blocks.some((block) => (blockText(block)?.length ?? 0) > 0) === true;
		}
		/** Native composer stop (or any idle edge) before the last turn's first token. */
		function shouldUnsendOnIdle(wasRunning, running, hasFirstToken) {
			return wasRunning === true && running === false && !hasFirstToken;
		}
		//#endregion
		//#region src/client/controller.ts
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		async function postRevise(operation) {
			const response = await fetch(REVISE_PATH, {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/json"
				},
				body: JSON.stringify(operation)
			});
			const value = await response.json();
			if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : `请求失败：HTTP ${response.status}`);
			if (typeof value.sessionId !== "string" || typeof value.queuedTurns !== "number") throw new Error("操作响应无效");
			return value;
		}
		var ReviseController = class {
			ctx;
			sessionId;
			face;
			store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
				pending: false,
				error: null
			});
			sessions;
			navigationWaits = /* @__PURE__ */ new Set();
			constructor(ctx, sessionId) {
				this.ctx = ctx;
				this.sessionId = sessionId;
				this.sessions = ctx.sessions;
				this.face = {
					hooks: { revise: this.store },
					edit: (message, text) => this.edit(message, text)
				};
				ctx.effect(() => this.observeNativeCancel(), `msg-revise: observe native cancel ${sessionId}`);
			}
			dispose() {
				for (const cancel of [...this.navigationWaits]) cancel();
			}
			/**
			* Native InputBar owns stop (`session.cancel`). This service only reacts:
			* a running→idle edge before TTFT unsends the last prompt into the composer.
			*/
			observeNativeCancel() {
				let lastRunning;
				let sessionFace;
				let sessionDispose;
				const bind = () => {
					const next = this.sessions.binding(this.sessionId)?.session;
					if (next === sessionFace) return;
					sessionDispose?.();
					sessionFace = next;
					lastRunning = next?.getSnapshot().running;
					sessionDispose = next?.subscribe(() => {
						if (sessionFace !== next) return;
						const snapshot = next.getSnapshot();
						const wasRunning = lastRunning;
						lastRunning = snapshot.running;
						if (!shouldUnsendOnIdle(wasRunning, snapshot.running, snapshotHasFirstToken(snapshot))) return;
						this.unsendAfterNativeStop();
					});
				};
				bind();
				const disposeList = this.sessions.list.subscribe(() => {
					bind();
				});
				return () => {
					disposeList();
					sessionDispose?.();
				};
			}
			async edit(message, text) {
				if (this.store.getSnapshot().pending) return false;
				this.store.update((state) => {
					state.pending = true;
					state.error = null;
				});
				try {
					const session = this.sessions.binding(this.sessionId)?.session;
					if (session !== void 0) try {
						await session.cancel();
					} catch {}
					const result = await postRevise({
						action: "edit",
						sessionId: this.sessionId,
						eventSeq: message.eventSeq,
						blockIndex: message.blockIndex,
						text
					});
					this.store.update((state) => {
						state.pending = false;
					});
					await this.openWhenListed(result.sessionId);
					return true;
				} catch (error) {
					this.store.update((state) => {
						state.pending = false;
						state.error = messageOf(error);
					});
					return false;
				}
			}
			async unsendAfterNativeStop() {
				if (this.store.getSnapshot().pending) return;
				this.store.update((state) => {
					state.pending = true;
					state.error = null;
				});
				try {
					const result = await postRevise({
						action: "unsend",
						sessionId: this.sessionId
					});
					this.store.update((state) => {
						state.pending = false;
					});
					await this.openWhenListed(result.sessionId);
					if (typeof result.restoredText === "string") this.restoreDraft(result.sessionId, result.restoredText);
				} catch (error) {
					if (messageOf(error).includes("首字已到达")) {
						this.store.update((state) => {
							state.pending = false;
						});
						return;
					}
					this.store.update((state) => {
						state.pending = false;
						state.error = messageOf(error);
					});
				}
			}
			restoreDraft(sessionId, text) {
				const conversation = this.ctx.get("conversation");
				const scope = this.sessions.scope(sessionId);
				if (conversation === void 0 || scope === void 0) return;
				conversation.input.for(scope).setDraft(text);
			}
			openWhenListed(sessionId) {
				if (this.sessions.list.getSnapshot().byId[sessionId] !== void 0) {
					this.sessions.open(sessionId);
					return Promise.resolve();
				}
				return new Promise((resolve) => {
					let settled = false;
					let dispose = () => {};
					const finish = (open) => {
						if (settled) return;
						settled = true;
						dispose();
						this.navigationWaits.delete(cancel);
						if (open) this.sessions.open(sessionId);
						resolve();
					};
					const cancel = () => {
						finish(false);
					};
					this.navigationWaits.add(cancel);
					dispose = this.sessions.list.subscribe(() => {
						if (this.sessions.list.getSnapshot().byId[sessionId] === void 0) return;
						finish(true);
					});
					if (this.sessions.list.getSnapshot().byId[sessionId] !== void 0) finish(true);
				});
			}
		};
		//#endregion
		//#region src/client/messages.ts
		/** Zero-latency user blocks from the live conversation snapshot. */
		function snapshotUserMessages(nodes) {
			const result = [];
			for (let index = 0; index < nodes.length; index += 1) {
				const node = nodes[index];
				if (node === void 0 || node.kind !== "user") continue;
				const user = node;
				let turn = 0;
				for (let next = index + 1; next < nodes.length; next += 1) {
					const candidate = nodes[next];
					if (candidate?.kind === "assistant") {
						turn = candidate.turn;
						break;
					}
					if (candidate?.kind === "user") break;
				}
				for (const [blockIndex, block] of user.content.entries()) {
					if (block.type !== "text" || typeof block.text !== "string") continue;
					result.push({
						key: `${user.seq}:${blockIndex}`,
						turn,
						eventSeq: user.seq,
						blockIndex,
						text: block.text,
						time: user.time
					});
				}
			}
			return result;
		}
		/**
		* Pencil is only for the last user prompt after the native stop
		* (or never completed). Finished Q&A rows stay icon-free.
		*/
		function revisableAfterStop(nodes, users, running) {
			if (running) return void 0;
			const last = users.at(-1);
			if (last === void 0) return void 0;
			let lastUserIndex = -1;
			for (let index = 0; index < nodes.length; index += 1) {
				const node = nodes[index];
				if (node?.kind === "user" && node.seq === last.eventSeq) lastUserIndex = index;
			}
			if (lastUserIndex < 0) return last;
			for (let index = lastUserIndex + 1; index < nodes.length; index += 1) {
				const node = nodes[index];
				if (node?.kind === "user") break;
				if (node?.kind === "assistant" && node.interrupted !== true) return void 0;
			}
			return last;
		}
		//#endregion
		//#region src/match.ts
		/** Needle used to claim a message action row for one user block. */
		function matchNeedle(text) {
			const trimmed = text.trim();
			if (trimmed.length <= 64) return trimmed;
			return trimmed.slice(0, 48);
		}
		/**
		* Claim the first unclaimed user block whose needle appears in the action-row
		* ancestor text. Sequential claiming keeps two similar prompts from colliding.
		*/
		function pickUserBlock(rowText, users, claimed) {
			const haystack = rowText.trim();
			if (haystack.length === 0) return void 0;
			for (const user of users) {
				if (claimed.has(user.eventSeq)) continue;
				if (user.text.trim().length === 0) continue;
				if (haystack.includes(matchNeedle(user.text))) return user;
			}
		}
		//#endregion
		//#region \0dsh-css:/Users/tangxiaoxi/work/dsh-sci/dsh-msg-revise/src/client/Revise.module.css.mjs
		const css = ".l0kWMW_chip,.l0kWMW_inline,.l0kWMW_input,.l0kWMW_footer,.l0kWMW_save,.l0kWMW_cancel{box-sizing:border-box}.l0kWMW_chip{width:24px;height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;margin-left:2px;padding:0;display:inline-flex}.l0kWMW_chip:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.l0kWMW_inline{flex-direction:column;gap:10px;width:100%;min-width:220px;display:flex}.l0kWMW_input{width:100%;min-height:24px;max-height:360px;color:inherit;font:inherit;line-height:inherit;resize:none;background:0 0;border:none;border-radius:0;margin:0;padding:0;display:block;overflow-y:auto}.l0kWMW_input:focus{outline:none}.l0kWMW_footer{justify-content:flex-end;align-items:center;gap:8px;display:flex}.l0kWMW_save,.l0kWMW_cancel{cursor:pointer;border-radius:14px;justify-content:center;align-items:center;height:28px;padding:0 12px;font-size:12px;line-height:18px;display:inline-flex}.l0kWMW_save{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border:none}.l0kWMW_save:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.l0kWMW_save:disabled{opacity:.4;cursor:not-allowed}.l0kWMW_cancel{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:0 0}.l0kWMW_cancel:hover{background:var(--dsw-alias-interactive-bg-hover)}";
		const tagId = "dsh-msg-revise/Revise.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-msg-revise";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Revise_module_css_default = {
			"inline": "l0kWMW_inline",
			"footer": "l0kWMW_footer",
			"cancel": "l0kWMW_cancel",
			"save": "l0kWMW_save",
			"input": "l0kWMW_input",
			"chip": "l0kWMW_chip"
		};
		//#endregion
		//#region src/client/Revise.tsx
		/**
		* Injects 修改 on each matched user row. The editor replaces the bubble
		* text in place — it does not open a page-level dialog.
		*/
		const STYLE = {
			inline: Revise_module_css_default["inline"] ?? "",
			input: Revise_module_css_default["input"] ?? "",
			footer: Revise_module_css_default["footer"] ?? "",
			chip: Revise_module_css_default["chip"] ?? "",
			save: Revise_module_css_default["save"] ?? "",
			cancel: Revise_module_css_default["cancel"] ?? ""
		};
		function pencilIcon() {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("width", "16");
			svg.setAttribute("height", "16");
			svg.setAttribute("viewBox", "0 0 16 16");
			svg.setAttribute("fill", "none");
			svg.setAttribute("aria-hidden", "true");
			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("d", "M10.8 2.7l2.5 2.5-8 8H2.8v-2.5l8-8z");
			path.setAttribute("stroke", "currentColor");
			path.setAttribute("stroke-width", "1.25");
			path.setAttribute("stroke-linejoin", "round");
			path.setAttribute("stroke-linecap", "round");
			svg.appendChild(path);
			return svg;
		}
		function userRowOf(flow) {
			const row = flow.querySelector("[data-time-hover-root]");
			return row instanceof HTMLElement ? row : void 0;
		}
		/** The text bubble inside a user flow item (sibling stack of the action row). */
		function findBubble(flow) {
			const stack = userRowOf(flow)?.firstElementChild;
			if (!(stack instanceof HTMLElement)) return void 0;
			for (let index = stack.children.length - 1; index >= 0; index -= 1) {
				const child = stack.children[index];
				if (!(child instanceof HTMLElement)) continue;
				if (child.dataset.dshMsgReviseEditor === "1") continue;
				const className = child.className;
				if (typeof className === "string" && className.includes("bubble")) return child;
			}
			const last = stack.lastElementChild;
			return last instanceof HTMLElement ? last : void 0;
		}
		function mountEditor(flow, block, draft, edit, close, onDraft) {
			const bubble = findBubble(flow);
			if (bubble === void 0) return () => {};
			const hidden = [];
			for (const child of Array.from(bubble.children)) {
				if (!(child instanceof HTMLElement)) continue;
				if (child.dataset.dshMsgReviseEditor === "1") {
					child.remove();
					continue;
				}
				child.hidden = true;
				hidden.push(child);
			}
			const editor = document.createElement("div");
			editor.className = STYLE.inline;
			editor.dataset.dshMsgReviseEditor = "1";
			const input = document.createElement("textarea");
			input.className = STYLE.input;
			input.value = draft;
			input.setAttribute("aria-label", "修改提问");
			const footer = document.createElement("div");
			footer.className = STYLE.footer;
			const save = document.createElement("button");
			save.type = "button";
			save.className = STYLE.save;
			save.textContent = "重新发送";
			const cancel = document.createElement("button");
			cancel.type = "button";
			cancel.className = STYLE.cancel;
			cancel.textContent = "取消";
			footer.append(cancel, save);
			editor.append(input, footer);
			bubble.appendChild(editor);
			const chip = flow.querySelector("[data-dsh-msg-revise-btn=\"1\"]");
			if (chip !== null) chip.hidden = true;
			const autoSize = () => {
				input.style.height = "auto";
				input.style.height = `${Math.min(Math.max(input.scrollHeight, 24), 360)}px`;
			};
			input.addEventListener("input", () => {
				onDraft(input.value);
				autoSize();
			});
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
			autoSize();
			let mounted = true;
			let saving = false;
			const saveEdit = () => {
				if (saving) return;
				saving = true;
				save.disabled = true;
				edit(block, input.value).then((applied) => {
					if (!mounted) return;
					if (applied) {
						close();
						return;
					}
					saving = false;
					save.disabled = false;
				});
			};
			const onKey = (event) => {
				if (event.key === "Escape") {
					event.stopPropagation();
					close();
				}
				if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
					event.preventDefault();
					saveEdit();
				}
			};
			save.addEventListener("click", saveEdit);
			cancel.addEventListener("click", close);
			input.addEventListener("keydown", onKey);
			return () => {
				mounted = false;
				save.removeEventListener("click", saveEdit);
				cancel.removeEventListener("click", close);
				input.removeEventListener("keydown", onKey);
				editor.remove();
				for (const child of hidden) child.hidden = false;
				if (chip !== null) chip.hidden = false;
			};
		}
		function Revise({ allowed, edit }) {
			(0, react.useEffect)(() => {
				const cleanups = [];
				let active;
				let activeSeq;
				let draft = "";
				const closeEditor = () => {
					active?.();
					active = void 0;
					activeSeq = void 0;
					draft = "";
				};
				const editBlock = (flow, block, initial) => {
					active?.();
					draft = initial;
					activeSeq = block.eventSeq;
					active = mountEditor(flow, block, draft, edit, closeEditor, (text) => {
						draft = text;
					});
				};
				const detach = (row) => {
					row.querySelector("[data-dsh-msg-revise-btn=\"1\"]")?.remove();
					delete row.dataset.dshMsgRevise;
					delete row.dataset.dshMsgReviseSeq;
				};
				const sync = () => {
					const claimed = /* @__PURE__ */ new Set();
					const targets = allowed === void 0 ? [] : [allowed];
					const rows = Array.from(document.querySelectorAll("[data-chat-flow-kind=\"user\"] [class*=\"actions\"]"));
					for (const row of rows) {
						const existing = row.querySelector("[data-dsh-msg-revise-btn=\"1\"]");
						if (row.dataset.dshMsgRevise === "1" && existing !== null) {
							const seq = Number(row.dataset.dshMsgReviseSeq);
							if (allowed !== void 0 && seq === allowed.eventSeq) {
								claimed.add(seq);
								continue;
							}
							detach(row);
						}
						if (allowed === void 0) continue;
						const flow = row.closest("[data-chat-flow-kind=\"user\"]");
						if (flow === null) continue;
						const block = pickUserBlock((flow.textContent ?? "").trim(), targets, claimed);
						if (block === void 0) continue;
						claimed.add(block.eventSeq);
						const button = document.createElement("button");
						button.type = "button";
						button.className = STYLE.chip;
						button.dataset.dshMsgReviseBtn = "1";
						button.setAttribute("aria-label", "修改");
						button.title = "修改后重新发送";
						button.appendChild(pencilIcon());
						const open = (event) => {
							event.preventDefault();
							event.stopPropagation();
							editBlock(flow, block, block.text);
						};
						button.addEventListener("click", open);
						const official = Array.from(row.querySelectorAll("button")).at(-1);
						if (official !== void 0) official.insertAdjacentElement("afterend", button);
						else row.appendChild(button);
						row.dataset.dshMsgRevise = "1";
						row.dataset.dshMsgReviseSeq = String(block.eventSeq);
						cleanups.push(() => {
							button.removeEventListener("click", open);
							button.remove();
							delete row.dataset.dshMsgRevise;
							delete row.dataset.dshMsgReviseSeq;
						});
					}
					if (activeSeq === void 0 || allowed === void 0 || activeSeq !== allowed.eventSeq) {
						if (activeSeq !== void 0 && (allowed === void 0 || activeSeq !== allowed.eventSeq)) closeEditor();
						return;
					}
					const flow = document.querySelector(`[data-chat-flow-kind="user"] [data-dsh-msg-revise-seq="${String(activeSeq)}"]`)?.closest("[data-chat-flow-kind=\"user\"]");
					if (flow === null || flow === void 0) return;
					if (findBubble(flow)?.querySelector("[data-dsh-msg-revise-editor=\"1\"]") !== null) return;
					editBlock(flow, allowed, draft || allowed.text);
				};
				sync();
				const observer = new MutationObserver(sync);
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
				return () => {
					observer.disconnect();
					closeEditor();
					for (const cleanup of cleanups.reverse()) cleanup();
				};
			}, [allowed, edit]);
			return null;
		}
		//#endregion
		//#region src/client/Header.tsx
		/** Mounts the pencil only. Native composer owns stop. */
		function Header({ useSession, edit }) {
			const running = useSession((snapshot) => snapshot.running);
			const nodes = useSession((snapshot) => snapshot.nodes);
			const messages = (0, react.useMemo)(() => snapshotUserMessages(nodes), [nodes]);
			const allowed = (0, react.useMemo)(() => revisableAfterStop(nodes, messages, running), [
				nodes,
				messages,
				running
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Revise, {
				allowed,
				edit
			});
		}
		//#endregion
		//#region src/client/index.ts
		const inject = [
			"slots",
			"conversation",
			"connection",
			"sessions"
		];
		function apply(ctx) {
			const controllers = /* @__PURE__ */ new Map();
			const controllerFor = (sessionId) => {
				let controller = controllers.get(sessionId);
				if (controller === void 0) {
					controller = new ReviseController(ctx, sessionId);
					controllers.set(sessionId, controller);
				}
				return controller;
			};
			ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "msg-revise-controls",
				order: 14,
				inject: (sessionId) => controllerFor(sessionId).face
			}, Header);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map