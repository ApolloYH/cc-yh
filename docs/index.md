---
layout: home

hero:
  name: Claude-YH
  text: 本地优先的主动型智能体工作台
  tagline: CLI、Web 和 Windows 桌面端共享同一套配置，内置 Jarvis、长期记忆、BrowserControl、Rust Runtime 和 IM 接入。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/ApolloYH/cc-yh

features:
  - icon: 🖥️
    title: CLI / Web / Windows 桌面端
    details: 三端共享 ~/.claude-yh/settings.json，CLI 可全局运行，桌面端提供可视化设置和会话管理。
    link: /guide/quick-start
  - icon: 🧠
    title: L1-L4 长期记忆
    details: 原有记忆机制保留为主系统，增强为 L1 摘要、L2 事实、L3 SOP/Skill、L4 会话归档。
    link: /memory/
  - icon: 📡
    title: Jarvis 常驻智能体
    details: 单一长期对话入口，接收桌面、Web、CLI 和 IM 消息，安排 Manager CLI 执行任务并主动汇报。
    link: /features/jarvis
  - icon: 🌐
    title: BrowserControl
    details: 连接当前 Chrome 会话和登录态，支持读 DOM、截图、点击、输入、控制台和网络日志。
    link: /features/browser-control
  - icon: 🤖
    title: 原生多 Agent 能力
    details: Jarvis 将完整目标交给 Manager CLI，由原生 Todo、Task/Subagent 和工具系统完成内部规划。
    link: /agent/
  - icon: 🧩
    title: Skills 自进化
    details: 成功经验可自动沉淀为 claude-yh 专属 Skill，Skill 走独立发现入口，不挤占 L1 摘要。
    link: /skills/01-usage-guide
  - icon: 🚀
    title: Rust Runtime
    details: 安全策略、文件边界、搜索、会话索引和 Jarvis 队列优先走 Rust runtime，TypeScript fallback 兜底。
    link: /reference/rust-runtime
  - icon: 🔎
    title: 第三方模型与 Web 搜索
    details: 支持 Anthropic/OpenAI 兼容模型、独立 Web Search 配置和自定义提供商。
    link: /guide/third-party-models
  - icon: 💬
    title: IM 接入
    details: Telegram、飞书等渠道统一进入 Jarvis，而不是分散成孤立对话。
    link: /im/
---
