import { registerBundledSkill } from '../bundledSkills.js'

const PROMPT = `BrowserControl is a core claude-yh capability for using the user's current Chrome browser through the local TMWD bridge.

Default backend:
- tmwd-cdp-bridge
- Local bridge: ws://127.0.0.1:18765
- Chrome extension source: extensions/tmwd_cdp_bridge
- Shared config key: browserControl in ~/.claude-yh/settings.json

What it can do when connected:
- list current tabs
- read page DOM/text
- navigate a tab
- click and type on selected pages
- take screenshots
- read console and resource timing
- read cookies and make raw CDP calls when high-risk capabilities are enabled

Important operating rules:
- Prefer tabs.read first to understand the user's current browser state.
- Use the current Chrome session instead of launching a separate browser when the user wants existing login state or cookies.
- Do not attempt to bypass captcha, 2FA, login security, payment confirmation, or other human-only checks.
- Treat cookie reads, raw CDP calls, external sends, form submission, payment, account changes, and destructive actions as sensitive. Ask for confirmation unless the user has explicitly approved the exact action.
- There is no domain allow/deny policy. Do not ask the user to run /browser allow or edit allowed domains.
- If an action fails, inspect the BrowserControl error and current tabs before asking the user to do it manually.

User-facing configuration:
- CLI: /browser status, /browser tabs, /browser smoke, /browser high-risk on|off, /browser confirm on|off
- Web/Desktop: Settings -> Browser
`

export function registerBrowserControlSkill(): void {
  registerBundledSkill({
    name: 'browser-control',
    aliases: ['browser'],
    description:
      'Use claude-yh BrowserControl to operate the current Chrome session through the local TMWD bridge.',
    whenToUse:
      'Use when the user asks to inspect or operate a website, use existing browser login state/cookies, automate a page, read tabs, or configure browser automation.',
    allowedTools: [],
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{
        type: 'text',
        text: args ? `${PROMPT}\n\n## Task\n\n${args}` : PROMPT,
      }]
    },
  })
}
