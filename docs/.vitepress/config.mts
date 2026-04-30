import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

function slugify(str: string): string {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-')
}

const repo = 'https://github.com/ApolloYH/cc-yh'

const zhSidebar = [
  {
    text: '快速开始',
    items: [
      { text: '安装与启动', link: '/guide/quick-start' },
      { text: '配置说明', link: '/guide/env-vars' },
      { text: '第三方模型', link: '/guide/third-party-models' },
      { text: '全局使用', link: '/guide/global-usage' },
      { text: '常见问题', link: '/guide/faq' },
    ],
  },
  {
    text: '核心能力',
    collapsed: false,
    items: [
      { text: 'Jarvis 常驻智能体', link: '/features/jarvis' },
      { text: 'BrowserControl', link: '/features/browser-control' },
      { text: 'Computer Use', link: '/features/computer-use' },
    ],
  },
  {
    text: '记忆与技能',
    collapsed: false,
    items: [
      { text: '记忆概览', link: '/memory/' },
      { text: '使用指南', link: '/memory/01-usage-guide' },
      { text: '实现说明', link: '/memory/02-implementation' },
      { text: 'Skills 使用', link: '/skills/01-usage-guide' },
      { text: 'Skills 实现', link: '/skills/02-implementation' },
    ],
  },
  {
    text: '桌面端与 IM',
    collapsed: false,
    items: [
      { text: '桌面端概览', link: '/desktop/' },
      { text: '桌面端快速上手', link: '/desktop/01-quick-start' },
      { text: '桌面端架构', link: '/desktop/02-architecture' },
      { text: '桌面端功能', link: '/desktop/03-features' },
      { text: '安装与构建', link: '/desktop/04-installation' },
      { text: 'IM 接入', link: '/im/' },
      { text: 'Telegram', link: '/im/telegram' },
      { text: '飞书', link: '/im/feishu' },
    ],
  },
  {
    text: 'Agent 与参考',
    collapsed: true,
    items: [
      { text: '多 Agent 概览', link: '/agent/' },
      { text: 'Agent 使用指南', link: '/agent/01-usage-guide' },
      { text: 'Agent 实现原理', link: '/agent/02-implementation' },
      { text: 'Agent 框架解析', link: '/agent/03-agent-framework' },
      { text: '项目结构', link: '/reference/project-structure' },
      { text: 'Rust Runtime', link: '/reference/rust-runtime' },
      { text: '能力接口边界', link: '/reference/runtime-interfaces' },
      { text: '修复记录', link: '/reference/fixes' },
    ],
  },
]

const enSidebar = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Quick Start', link: '/en/guide/quick-start' },
      { text: 'Configuration', link: '/en/guide/env-vars' },
      { text: 'Third-Party Models', link: '/en/guide/third-party-models' },
      { text: 'Global Usage', link: '/en/guide/global-usage' },
      { text: 'FAQ', link: '/en/guide/faq' },
    ],
  },
  {
    text: 'Core Features',
    collapsed: false,
    items: [
      { text: 'Jarvis', link: '/features/jarvis' },
      { text: 'BrowserControl', link: '/features/browser-control' },
      { text: 'Computer Use', link: '/en/features/computer-use' },
    ],
  },
  {
    text: 'Memory and Skills',
    collapsed: false,
    items: [
      { text: 'Memory Overview', link: '/en/memory/' },
      { text: 'Memory Usage', link: '/en/memory/01-usage-guide' },
      { text: 'Memory Implementation', link: '/en/memory/02-implementation' },
      { text: 'Skills Usage', link: '/en/skills/01-usage-guide' },
      { text: 'Skills Implementation', link: '/en/skills/02-implementation' },
    ],
  },
  {
    text: 'Desktop and IM',
    collapsed: false,
    items: [
      { text: 'Desktop Overview', link: '/en/desktop/' },
      { text: 'Desktop Quick Start', link: '/en/desktop/01-quick-start' },
      { text: 'Desktop Architecture', link: '/en/desktop/02-architecture' },
      { text: 'Desktop Features', link: '/en/desktop/03-features' },
      { text: 'Installation', link: '/en/desktop/04-installation' },
      { text: 'IM Overview', link: '/im/' },
    ],
  },
  {
    text: 'Reference',
    collapsed: true,
    items: [
      { text: 'Agent Overview', link: '/en/agent/' },
      { text: 'Project Structure', link: '/en/reference/project-structure' },
      { text: 'Source Fixes', link: '/en/reference/fixes' },
    ],
  },
]

export default withMermaid(defineConfig({
  title: 'claude-yh',
  description: '本地优先的主动型智能体工作台，支持 CLI、Web、Windows 桌面端、Jarvis、长期记忆、BrowserControl 和 Rust Runtime。',
  lastUpdated: true,
  base: '/',

  markdown: {
    anchor: { slugify },
  },

  locales: {
    root: {
      label: '中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '首页', link: '/' },
          { text: '快速开始', link: '/guide/quick-start' },
          { text: 'Jarvis', link: '/features/jarvis' },
        ],
        sidebar: zhSidebar,
        outline: { label: '页面导航' },
        returnToTopLabel: '返回顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '主题',
        lastUpdated: { text: '最后更新于' },
        docFooter: { prev: '上一页', next: '下一页' },
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      description: 'A local-first agentic coding workspace with CLI, Web UI, Windows desktop app, Jarvis, memory, BrowserControl, and Rust Runtime.',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Quick Start', link: '/en/guide/quick-start' },
          { text: 'Jarvis', link: '/features/jarvis' },
        ],
        sidebar: enSidebar,
      },
    },
  },

  themeConfig: {
    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: '在 GitHub 上编辑此页',
    },
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: repo },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2026 claude-yh contributors',
    },
  },
}))

