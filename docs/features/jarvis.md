# Jarvis 常驻智能体

Jarvis 是 claude-yh 的 24 小时主动型智能体入口。它不是普通定时任务，也不是独立规则脚本，而是一条长期存在的模型对话流：用户、桌面端、Web、CLI 和 IM 的消息都会进入同一个 Jarvis Session。

## 核心模型

```text
用户 / IM / Desktop / Web / CLI
        ↓
Jarvis Session Transcript
        ↓
Jarvis 主模型
        ↓
Jarvis Tool Layer
        ├─ schedule_reminder
        ├─ create_task
        ├─ control_task
        ├─ query_status
        ├─ browser
        ├─ memory
        ├─ send_message
        └─ start_manager_cli
```

Jarvis 主模型负责理解用户意图、维护对话上下文、调用工具和决定是否启动 Manager CLI。普通问答会直接回复；完整任务会创建 Jarvis task，并由 Manager CLI 执行。

## 与普通对话的区别

| 能力 | 普通会话 | Jarvis |
| ---- | ---- | ---- |
| 生命周期 | 一个会话窗口 | 长期常驻 |
| 输入来源 | 当前 UI | Desktop / Web / CLI / IM |
| 主动事件 | 少 | 定时器、任务进度、IM、worker 结果都会进入 |
| 任务执行 | 当前会话直接执行 | Jarvis 管理任务，必要时启动 Manager CLI |
| 汇报方式 | 当前轮结果 | 可主动汇报、静音、恢复、最终总结 |

## 任务调度

Jarvis 遵循“一个用户目标，一个 task”的原则。

- Jarvis Router 只分类，不拆步骤。
- 完整任务交给 Manager CLI，由原生 Claude 的 Todo/Task/Subagent 能力自行规划。
- 状态真源在 Jarvis Service，Manager CLI 的 stream-json 只是事件来源。
- 同项目写任务默认串行，读任务可以并发。
- 全自主模式会给 Manager CLI 启动 `--dangerously-skip-permissions`，但仍保留日志、停止、取消和 kill 能力。

## 权限模式

| 模式 | 行为 |
| ---- | ---- |
| 观察模式 | 只观察和回复，不执行外部操作 |
| 辅助模式 | 常规操作可执行，敏感操作需要确认 |
| 自主模式 | 自动执行常规任务，高风险动作确认 |
| 全自主模式 | 不做权限确认，适合完全信任的本地自动化任务 |

权限模式在桌面/Web 设置页的 Jarvis 区域配置；CLI 和 IM 使用同一份 `~/.claude-yh/settings.json`。

## 主动事件策略

Jarvis 会把事件分为三类：

- 立即通知：任务失败、需要确认、定时提醒到期、用户必须介入。
- 摘要通知：长任务阶段完成、发现关键线索、最终结果。
- 静默记录：频繁工具调用、重复心跳、无价值中间输出。

用户可以在运行中要求“不要报告过程，只要最终结果”。这会由 Jarvis 主模型识别为控制意图，Jarvis Service 直接关闭该任务的中间汇报，不把这句话错误注入 Manager CLI 当作任务补充。

## 定时任务与提醒

“三分钟后发你好”“明天早上三点提醒我”等请求应优先调用 `schedule_reminder`，写入全局定时任务系统，而不是让 Manager CLI 自己 `sleep`。

定时器到期后事件会回灌给 Jarvis，Jarvis 再向用户发送自然语言提醒，例如：

```text
三分钟到了：你好
```

## 日志

Jarvis 的运行日志按 task 和 Manager CLI session 分开保存：

```text
~/.claude-yh/logs/jarvis/tasks/{taskId}.jsonl
~/.claude-yh/logs/jarvis/managers/{sessionId}.jsonl
```

日志包含 Router 结果、任务创建、CLI 启动参数、stream-json 原始事件、Reporter 摘要、控制操作、补充指令、错误、退出码、checkpoint 和最终报告。

## 新会话

Jarvis 是单一长期对话。如果需要清空当前 UI 对话历史并开启新 Jarvis 会话，可以发送：

```text
/new
```

旧历史会被备份，新的 Jarvis inbox 从空开始。

