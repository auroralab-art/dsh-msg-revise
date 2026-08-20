<!--
  dsh-msg-revise: DeepSeek Harness message edit and resend plugin
  Keywords: deepseek harness plugin, dsh plugin, edit message, resend,
  message revision, conversation fork, undo, retry, dsh-msg-revise, aurora lab
-->

<div align="center">

# dsh-msg-revise

**Edit and resend messages in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — stop the reply, revise your prompt, and re-run the turn.**

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](https://github.com/auroralab-art/dsh-msg-revise/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-v0.1.0--rc.1+-green)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

</div>

---

Stop a running reply, edit your last message in place, and resend — all without leaving the conversation. The previous version is archived so the sidebar stays clean, and a host restart can still open the original transcript.

## Why do I need this?

Stock DSH has no way to edit a sent message or retry a turn with different wording. If the model misunderstands you, you must start a new conversation or paste the corrected text as a follow-up.

`dsh-msg-revise` adds the missing edit-and-resend flow:

- Press the native **Stop** while a reply is running.
- If the model hasn't started replying yet: the prompt is pulled back into the composer automatically.
- If the model has already started: a pencil icon appears on your last message. Click it, edit in place, and hit **Resend**.
- The plugin forks the conversation from before that turn and re-runs with your revised prompt. The old branch is archived.

## Quick Start

```sh
dsh plugin --profile web add github:auroralab-art/dsh-msg-revise
```

Restart `dsh web`. That's it — the edit controls appear automatically when you stop a reply.

Local development:

```sh
dsh plugin --profile web add link:$PWD
```

## How does it work?

| Scenario | Behavior |
|----------|----------|
| Stop **before first token** (TTFT) | Prompt is unsent — pulled back into the composer, conversation returns to pre-send state |
| Stop **after first token** | Pencil icon appears on the last user message → click to edit in place → **Resend** forks and re-runs |

### The fork model

When you resend, the plugin:

1. Truncates the session from before the target turn.
2. Creates a child conversation with `agents.create({ seed, meta })`.
3. Sends the edited message as `followup` in the child.
4. Archives the source session — the sidebar shows only the new branch.
5. Version metadata is stored outside the session log, so the original is recoverable.

## What it does NOT do

- Does not rewrite historical events or past assistant messages.
- Does not restore workspace files changed by a previous turn.
- Does not patch the DSH engine or official UI packages.
- Does not add its own stop button — uses the native composer stop.

## FAQ

<details>
<summary><strong>Can I edit messages from earlier in the conversation?</strong></summary>

No. Currently only the last user message (the one that triggered the stopped reply) is editable. This keeps the fork model simple and predictable.
</details>

<details>
<summary><strong>What happens to the old conversation?</strong></summary>

It is archived internally. Version metadata lives in `DSH_HOME/storages/dsh-msg-revise/versions.json`. The session log is never modified — the original transcript can still be opened after a host restart.
</details>

<details>
<summary><strong>Does it work with the headless profile?</strong></summary>

No. This plugin targets the `web` profile only — it relies on the browser composer UI and DOM observation.
</details>

<details>
<summary><strong>Will this conflict with other UI plugins?</strong></summary>

Unlikely. The edit pencil is injected into the existing message action row via sequential matching. It does not replace native controls or require exclusive rendering.
</details>

<details>
<summary><strong>Which DSH version is required?</strong></summary>

Tested against DeepSeek Harness `v0.1.0-rc.6` and later. Uses `dsh-client-ui-conversation` injection.
</details>

## Compatibility

| Requirement | Version |
|---|---|
| DeepSeek Harness | `v0.1.0-rc.6`+ |
| Node.js | `^22.19.0` or `>=24.0.0` |
| Profile | `web` |

## Aurora Lab

This plugin is published by [Aurora Lab](https://github.com/auroralab-art). We build plugins that extend what DeepSeek Harness can do.

**Other plugins from Aurora Lab:**

- [dsh-file-ref](https://github.com/auroralab-art/dsh-file-ref) — Drag-and-drop file attachment for the composer
- [dsh-access](https://github.com/auroralab-art/dsh-access) — Remote access gateway with role tokens and device binding

## License

MIT. See [LICENSE](LICENSE).

## Develop

```sh
pnpm install
pnpm test
pnpm run build
dsh plugin --profile web add link:$PWD
```

Restart `dsh web` after install. Tests parse the DSH source (`vitest.config.ts`'s `DSH_ROOT`).
