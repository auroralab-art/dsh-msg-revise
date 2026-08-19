# dsh-msg-revise

用输入栏自带的 **停止生成** 停掉回复后，在用户消息上点 **修改**，改完再 **重新发送**。

旧版本自动归档，侧边栏只留当前这一条对话。版本记录写在会话日志之外，重启 dsh 后原会话仍可打开。

## 使用

1. 回复进行中，点输入栏原生的 **停止生成**（插件不再单独放一颗停止按钮）。
2. API 还没返回首 token：刚发出的提问收回输入框，对话回到发送前。
3. 首 token 已经回来后再停：最后一条用户消息旁出现铅笔图标。该条气泡原文就地变成输入框（不另开窗），改完点 **重新发送**。插件从该条提问之前切开，用新文本重新跑这一轮。

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
