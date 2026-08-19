# dsh-msg-revise

After the native composer stops a running DSH turn, press **修改** on that user message, edit the text, then **重新发送**.

## Locked decisions

- The plugin does **not** render a stop control. Native InputBar (`停止生成` / `input.stop`) owns `session.cancel()`.
- Conversation-body control is a 16px stroke pencil (`aria-label` **修改**). Confirm is **重新发送**. Cancel is **取消**.
- The pencil appears only after the current turn is stopped **and the LLM has already emitted a first token**. Finished turns stay icon-free.
- Native stop before TTFT (no `assistant/chunk` text/reasoning/tool delta yet) unsends: the client observes the running→idle edge, forks before that user turn, no followup, restore the text into the composer.
- Saving always `truncate`s from that turn. No assistant-block edit, no Timeline tab, no harness source patch.
- Version metadata lives in `DSH_HOME/storages/dsh-msg-revise/versions.json`. The session log never receives a custom event type.
- Fork uses `ctx.agents.create({ seed, meta })` cut **before** the target turn, then `followup` of the edited user message. Source session is archived; the child inherits the title.
- rc.6 has no public `conversation.chat.user-actions` slot. **修改** is injected into the existing message action row. Matching is sequential user-text inclusion, not first-24-char global scan.
- **修改** replaces the user bubble text in place. It does not open a page-level dialog. **重新发送** / **取消** sit under that same bubble.

## Roles

| Piece | Owns |
|---|---|
| `src/turns.ts` | Fold turn brackets; plan an edit |
| `src/match.ts` | Pair a DOM action row with a user block |
| `src/http.ts` | Trust fence, body cap, decode POST |
| `src/store.ts` | External version JSON |
| `src/host.ts` | Route, fork, archive |
| `src/client` | Observe native cancel, bubble-inline **修改**, POST, navigate to child |

## Out of v1

- A plugin-owned stop button (native InputBar already cancels)
- Assistant reasoning / response rewrite
- Timeline / undo-redo chrome
- Workspace file rewind
- Official user-actions slot (adopt when rc ships it)
