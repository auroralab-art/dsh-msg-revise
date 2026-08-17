# dsh-msg-revise

Stop an in-flight DeepSeek Harness reply, press **修改** on the user message, edit it, then **重新发送**.

The previous version is archived so the sidebar stays one conversation. Version metadata lives outside the session log, so a host restart can still open the original transcript.

## Use

1. While a reply is running, press **■ 停止** in the session header (or the stock stop).
2. After **■ 停止**, a pencil appears on the last user message.
3. The bubble text becomes an in-place editor (no dialog). Press **重新发送**. The plugin forks from before that turn and re-runs it with the new prompt.

Settled user messages can be revised the same way.

## Install

```bash
dsh plugin --profile web add -w link:/path/to/dsh-msg-revise
```

Restart `dsh web` after install.

## Scope

- Does not rewrite historical events.
- Does not restore workspace files.
- Does not patch the DSH engine or official UI packages.
