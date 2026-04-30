import type { BrowserControlBackend } from './types.js'

export const CLAUDE_IN_CHROME_BACKEND: BrowserControlBackend = {
  id: 'claude-in-chrome',
  kind: 'chrome-extension',
  displayName: 'Claude in Chrome',
  risk: 'medium',
  requiresExplicitInstall: true,
  capabilities: [
    'tabs.read',
    'page.navigate',
    'page.screenshot',
    'page.read_dom',
    'page.click',
    'page.type',
    'page.read_console',
    'page.read_network',
    'files.upload',
    'downloads.save',
  ],
}

export const MCP_BROWSER_BACKEND: BrowserControlBackend = {
  id: 'mcp-browser',
  kind: 'mcp',
  displayName: 'MCP Browser',
  risk: 'medium',
  requiresExplicitInstall: true,
  capabilities: [
    'tabs.read',
    'page.navigate',
    'page.screenshot',
    'page.read_dom',
    'page.click',
    'page.type',
    'page.read_console',
    'page.read_network',
    'files.upload',
    'downloads.save',
  ],
}

export const CHROME_DEVTOOLS_BACKEND: BrowserControlBackend = {
  id: 'chrome-devtools',
  kind: 'chrome-devtools',
  displayName: 'Chrome DevTools',
  risk: 'medium',
  requiresExplicitInstall: false,
  capabilities: [
    'tabs.read',
    'page.navigate',
    'page.screenshot',
    'page.read_dom',
    'page.click',
    'page.type',
    'page.read_console',
    'page.read_network',
    'storage.read_cookies',
    'cdp.call',
  ],
}

export const COMPUTER_USE_BACKEND: BrowserControlBackend = {
  id: 'computer-use',
  kind: 'computer-use',
  displayName: 'Computer Use',
  risk: 'medium',
  requiresExplicitInstall: true,
  capabilities: [
    'page.screenshot',
    'page.click',
    'page.type',
    'files.upload',
    'downloads.save',
  ],
}

export const TMWD_CDP_BRIDGE_BACKEND: BrowserControlBackend = {
  id: 'tmwd-cdp-bridge',
  kind: 'tmwd-cdp-bridge',
  displayName: 'TMWebDriver CDP Bridge',
  risk: 'high',
  requiresExplicitInstall: true,
  capabilities: [
    'tabs.read',
    'page.navigate',
    'page.screenshot',
    'page.read_dom',
    'page.click',
    'page.type',
    'page.read_console',
    'page.read_network',
    'files.upload',
    'downloads.save',
    'storage.read_cookies',
    'cdp.call',
    'headers.modify',
    'extensions.manage',
  ],
}

export const BROWSER_CONTROL_BACKENDS: readonly BrowserControlBackend[] = [
  CLAUDE_IN_CHROME_BACKEND,
  MCP_BROWSER_BACKEND,
  CHROME_DEVTOOLS_BACKEND,
  COMPUTER_USE_BACKEND,
  TMWD_CDP_BRIDGE_BACKEND,
]
