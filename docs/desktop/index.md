# 桌面端文档

> 图形化的 claude-yh 工作台，支持普通会话、Jarvis 常驻智能体、记忆管理、浏览器控制、定时任务和 IM 接入。

---

## 文档目录

### [快速上手](./01-quick-start.md)

面向用户的桌面端使用指南：界面布局、对话操作、权限控制、项目管理、模型配置、Jarvis、记忆、BrowserControl、IM 适配器和定时任务。

### [架构设计](./02-architecture.md)

面向开发者的技术架构：三层架构（Tauri → Server → CLI）、WebSocket 协议、HTTP API、状态管理、协议代理、适配器桥接、目录结构。

### [功能详解](./03-features.md)

深入每个功能模块：聊天引擎、代码展示、工具调用、Jarvis、记忆、BrowserControl、提供商管理、技能、定时任务、IM 适配器、设计系统。

### [安装指南](./04-installation.md)

下载安装、Windows 常见问题、Web UI 模式。

---

## 快速开始

### 用户

1. 阅读 [安装指南](./04-installation.md) 下载安装
2. 阅读 [快速上手](./01-quick-start.md) 了解界面和操作
3. 配置 AI 模型提供商，开始对话

### 开发者

1. 阅读 [架构设计](./02-architecture.md) 理解三层架构
2. 关键源码位置：
   - `desktop/src/` — React 前端
   - `desktop/src-tauri/` — Tauri Rust 后端
   - `desktop/sidecars/` — Sidecar 入口
   - `src/server/` — Express API 服务端
   - `adapters/` — IM 适配器

---

## 核心概念

| 概念 | 说明 |
|------|------|
| **Tauri** | 跨平台桌面框架，Rust 管理窗口和 Sidecar 进程 |
| **Sidecar** | 随主进程启动的后台服务，运行 API 服务器 |
| **Session** | 一次对话会话，绑定工作目录，通过 WebSocket 通信 |
| **Jarvis** | 24 小时常驻主动型智能体，统一接收 Desktop/Web/CLI/IM 消息 |
| **Provider** | AI 模型提供商，支持 Anthropic/OpenAI 兼容接口 |
| **BrowserControl** | 使用当前 Chrome 会话和登录态的浏览器控制能力 |
| **Adapter** | IM 适配器，Telegram/飞书/钉钉等渠道进入 Jarvis |
| **Store** | Zustand 状态容器，按领域拆分管理 |



