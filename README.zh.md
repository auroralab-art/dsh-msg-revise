<!--
  dsh-msg-revise: DeepSeek Harness 消息编辑重发插件
  关键词: DeepSeek Harness 插件, DSH 插件, 编辑消息, 重新发送,
  消息修改, 对话分叉, 撤回, 重试, dsh-msg-revise, Aurora Lab
-->

<div align="center">

# dsh-msg-revise

**在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中编辑并重新发送消息 — 停止回复、修改提问、重跑这一轮。**

[![版本](https://img.shields.io/badge/版本-0.1.0-blue)](https://github.com/auroralab-art/dsh-msg-revise/releases)
[![许可](https://img.shields.io/badge/许可-MIT-green)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-v0.1.0--rc.1+-green)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 中文

</div>

---

停止正在进行的回复，就地编辑你的最后一条消息，然后重新发送 — 全程不离开当前对话。旧版本自动归档，侧边栏保持干净，重启 dsh 后原始记录仍可打开。

## 为什么需要这个插件？

原版 DSH 没有编辑已发送消息或用不同措辞重试一轮的功能。如果模型误解了你，只能另开对话或把修正文本作为追问粘贴。

`dsh-msg-revise` 补上了缺失的编辑-重发流程：

- 回复进行中，点输入栏原生的 **停止生成**。
- 如果模型还没开始回复：刚发出的提问自动收回输入框。
- 如果模型已开始回复：最后一条用户消息旁出现铅笔图标。点击后就地编辑，改完按 **重新发送**。
- 插件从该轮之前切开对话、用修改后的文本重跑。旧分支自动归档。

## 快速开始

```sh
dsh plugin --profile web add github:auroralab-art/dsh-msg-revise
```

重启 `dsh web`。完成 — 停止回复时编辑控件会自动出现。

本地开发：

```sh
dsh plugin --profile web add link:$PWD
```

## 工作原理

| 场景 | 行为 |
|------|------|
| 首 token 之前停止（TTFT 前） | 消息撤回 — 自动拉回输入框，对话回到发送前状态 |
| 首 token 之后停止 | 铅笔图标出现 → 就地编辑 → **重新发送** 分叉并重跑 |

### 分叉模型

重新发送时，插件会：

1. 在目标轮次之前截断会话。
2. 用 `agents.create({ seed, meta })` 创建子对话。
3. 将编辑后的消息作为 `followup` 发送到子对话。
4. 归档原会话 — 侧边栏只显示新分支。
5. 版本元数据存储在会话日志之外，原始记录可恢复。

## 它不做什么

- 不改写历史事件或过去的助手消息。
- 不恢复上一轮改动过的工作区文件。
- 不修改 DSH 引擎或官方 UI 源码。
- 不添加自己的停止按钮 — 使用输入栏原生停止。

## 常见问题

<details>
<summary><strong>能编辑对话中更早的消息吗？</strong></summary>

目前不行。只有最后一条用户消息（触发被停止回复的那条）可编辑。这让分叉模型保持简单可预测。
</details>

<details>
<summary><strong>旧对话去哪了？</strong></summary>

自动归档。版本元数据存在 `DSH_HOME/storages/dsh-msg-revise/versions.json`。会话日志本身不被修改 — 重启 dsh 后原始记录仍可打开。
</details>

<details>
<summary><strong>能在 headless 模式下使用吗？</strong></summary>

不能。本插件仅面向 `web` profile，依赖浏览器对话栏 UI 和 DOM 观察。
</details>

<details>
<summary><strong>会和其他 UI 插件冲突吗？</strong></summary>

通常不会。编辑铅笔通过顺序匹配注入到现有消息操作行，不替换原生控件，不需要独占渲染器。
</details>

<details>
<summary><strong>需要哪个版本的 DSH？</strong></summary>

在 DeepSeek Harness `v0.1.0-rc.6` 及更新版本上测试通过。使用 `dsh-client-ui-conversation` 注入。
</details>

## 兼容性

| 依赖 | 版本 |
|---|---|
| DeepSeek Harness | `v0.1.0-rc.6`+ |
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| Profile | `web` |

## Aurora Lab

本插件由 [Aurora Lab](https://github.com/auroralab-art) 发布。我们构建 DeepSeek Harness 增强插件。

**Aurora Lab 其他插件：**

- [dsh-file-ref](https://github.com/auroralab-art/dsh-file-ref) — 对话栏拖拽/粘贴文件附件
- [dsh-access](https://github.com/auroralab-art/dsh-access) — 远程访问网关，角色令牌 + 单设备绑定

## 许可

MIT。见 [LICENSE](LICENSE)。

## 开发

```sh
pnpm install
pnpm test
pnpm run build
dsh plugin --profile web add link:$PWD
```

安装后重启 `dsh web`。测试解析 DSH 源码（`vitest.config.ts` 的 `DSH_ROOT`）。
