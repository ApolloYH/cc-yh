import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

process.env.CLAUDE_CONFIG_DIR ||= join(homedir(), '.claude-yh');
bootstrapEnvFromNearestDotEnv();

const version = process.env.CLAUDE_CODE_LOCAL_VERSION ?? '999.0.0-local';
const packageUrl = process.env.CLAUDE_CODE_LOCAL_PACKAGE_URL ?? 'claude-code-local';
const buildTime = process.env.CLAUDE_CODE_LOCAL_BUILD_TIME ?? new Date().toISOString();

process.env.CLAUDE_CODE_LOCAL_SKIP_REMOTE_PREFETCH ??= '1';

if (
  process.argv.includes('test') &&
  typeof globalThis.window === 'undefined' &&
  typeof globalThis.document === 'undefined'
) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    CustomEvent: window.CustomEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame:
      window.requestAnimationFrame?.bind(window) ??
      ((cb: FrameRequestCallback) =>
        setTimeout(() => cb(Date.now()), 16) as unknown as number),
    cancelAnimationFrame:
      window.cancelAnimationFrame?.bind(window) ??
      ((id: number) => clearTimeout(id)),
  });
}

Object.assign(globalThis, {
  MACRO: {
    VERSION: version,
    PACKAGE_URL: packageUrl,
    NATIVE_PACKAGE_URL: packageUrl,
    BUILD_TIME: buildTime,
    FEEDBACK_CHANNEL: 'local',
    VERSION_CHANGELOG: '',
    ISSUES_EXPLAINER: '',
  },
});
// Switch to the current workspace
if (process.env.CALLER_DIR) {
  process.chdir(process.env.CALLER_DIR);
}
export {}

function bootstrapEnvFromNearestDotEnv() {
  if (
    process.env.CLAUDE_YH_SKIP_DOTENV === '1' ||
    process.env.CLAUDE_YH_USE_DOTENV !== '1'
  ) {
    sanitizeDesktopManagedProviderEnv();
    return;
  }

  const envPath = findNearestDotEnv();
  if (!envPath) return;

  for (const [key, value] of parseDotEnv(envPath)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  sanitizeDesktopManagedProviderEnv();
}

function sanitizeDesktopManagedProviderEnv() {
  if (process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST !== '1') return;

  if (process.env.CLAUDE_YH_DESKTOP_API_FORMAT === 'anthropic') {
    delete process.env.CLAUDE_CODE_COMPAT_PROVIDER;
    delete process.env.CLAUDE_CODE_OPENAI_COMPAT_MODE;
  }
}

function findNearestDotEnv(): string | null {
  const searchRoots = new Set<string>();
  const cwd = process.cwd();
  if (cwd) searchRoots.add(resolve(cwd));
  if (process.env.CLAUDE_APP_ROOT) {
    searchRoots.add(resolve(process.env.CLAUDE_APP_ROOT));
  }
  if (process.execPath) {
    searchRoots.add(dirname(resolve(process.execPath)));
  }

  for (const startDir of searchRoots) {
    let current = startDir;
    while (true) {
      const candidate = join(current, '.env');
      if (existsSync(candidate)) {
        return candidate;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return null;
}

function parseDotEnv(filePath: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const raw = readFileSync(filePath, 'utf8');

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
    entries.push([key, value]);
  }

  return entries;
}
