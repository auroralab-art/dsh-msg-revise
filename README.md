# dsh-msg-revise

After the stock DeepSeek Harness stop, press **修改** on the user message, edit it, then **重新发送**.

The previous version is archived so the sidebar stays one conversation. Version metadata lives outside the session log, so a host restart can still open the original transcript.

## Use

1. While a reply is running, press the native composer **停止生成**.
2. Before the first token: the prompt is pulled back into the composer.
3. After the first token: a pencil appears on the last user message. The bubble text becomes an in-place editor (no dialog). Press **重新发送**. The plugin forks from before that turn and re-runs it with the new prompt.

## Install

```bash
dsh plugin --profile web add github:auroralab-art/dsh-msg-revise
```

Local development:

```bash
dsh plugin --profile web add -w link:/path/to/dsh-msg-revise
```

Restart `dsh web` after install.

## Scope

- Does not rewrite historical events.
- Does not restore workspace files.
- Does not patch the DSH engine or official UI packages.
