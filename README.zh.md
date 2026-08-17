# dsh-msg-revise

终止正在进行的回复后，在用户消息上点 **修改**，改完再 **重新发送**。

旧版本自动归档，侧边栏只留当前这一条对话。版本记录写在会话日志之外，重启 dsh 后原会话仍可打开。

## 使用

1. 回复进行中，标题栏点 **■ 停止**（或用 dsh 自带停止）。
2. 点 **■ 停止** 之后，最后一条用户消息旁出现铅笔图标。
3. 该条气泡原文就地变成输入框（不另开窗），改完点 **重新发送**。插件从该条提问之前切开，用新文本重新跑这一轮。

已结束的用户消息同样可以修改。

## 安装

```bash
dsh plugin --profile web add -w link:/Users/tangxiaoxi/work/dsh-sci/dsh-msg-revise
```

或在发布到 npm / GitHub 之后：

```bash
dsh plugin --profile web add github:<org>/dsh-msg-revise
```

然后重启 `dsh web`。

## 范围

- 不改写历史事件。
- 不恢复工作区文件。
- 不改 DSH 引擎或官方 UI 源码。
