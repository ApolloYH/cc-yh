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
- Keep the tabId/session id stable after tabs.read. Multi-tab tasks should always name the target tab explicitly.
- For click/type, prefer BrowserControl page.click/page.type on stable CSS selectors. The TMWD backend performs CDP mouseMoved/mousePressed/mouseReleased and native text insertion, which is more reliable than injected JavaScript.
- JavaScript-dispatched clicks and inputs can be rejected by sites because isTrusted=false. Use raw cdp.call only for inspection, recovery, or advanced frame/shadow DOM handling.
- For file upload, use files.upload on the real input[type=file] selector. It maps to CDP DOM.setFileInputFiles.
- For iframes, shadow DOM, canvas-heavy pages, zoomed pages, or elements visible in screenshots but missing from DOM text, take page.screenshot and then use cdp.call DOM.getDocument({pierce:true}), DOM.getBoxModel, Runtime.evaluate, Page.bringToFront, or frame inspection.
- If an action fails, inspect BrowserControl statusCode, error, and recovery.nextActions; then run tabs.read, page.read_dom, and page.screenshot before asking the user to do it manually.

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
