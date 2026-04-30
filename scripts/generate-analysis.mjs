import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE_ROOTS = [
  { label: 'src', dir: path.join(ROOT, 'src') },
  { label: 'desktop-src', dir: path.join(ROOT, 'desktop', 'src') },
];
const OUTPUT_ROOT = path.join(ROOT, 'analysis');
const GENERATED_ROOT = path.join(OUTPUT_ROOT, 'generated');
const GROUPS_ROOT = path.join(GENERATED_ROOT, 'groups');
const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'throw',
  'typeof',
  'instanceof',
  'await',
  'new',
]);

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(abs)));
      continue;
    }
    if (!abs.endsWith('.ts') && !abs.endsWith('.tsx')) continue;
    files.push(abs);
  }
  return files;
}

function splitLines(text) {
  return text.split(/\r?\n/);
}

function computeLineStarts(lines) {
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
}

function lineOfOffset(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = starts[mid];
    const next = mid + 1 < starts.length ? starts[mid + 1] : Number.MAX_SAFE_INTEGER;
    if (offset >= start && offset < next) return mid + 1;
    if (offset < start) high = mid - 1;
    else low = mid + 1;
  }
  return 1;
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function humanizeIdentifier(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function titleize(text) {
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanComment(raw) {
  return normalizeWhitespace(
    raw
      .replace(/^\/\*\*?/, '')
      .replace(/\*\/$/, '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\/\/\s?/, '').replace(/^\s*\*\s?/, ''))
      .join(' ')
  );
}

function getLeadingComment(lines, lineNumber) {
  const index = lineNumber - 2;
  if (index < 0) return '';

  const line = lines[index].trim();
  if (!line) return '';

  if (line.endsWith('*/')) {
    const commentLines = [];
    for (let i = index; i >= 0; i -= 1) {
      commentLines.unshift(lines[i]);
      if (lines[i].includes('/**') || lines[i].includes('/*')) {
        break;
      }
      if (i === 0) break;
    }
    return cleanComment(commentLines.join('\n'));
  }

  if (line.startsWith('//')) {
    const commentLines = [];
    for (let i = index; i >= 0; i -= 1) {
      const current = lines[i].trim();
      if (!current.startsWith('//')) break;
      commentLines.unshift(lines[i]);
    }
    return cleanComment(commentLines.join('\n'));
  }

  return '';
}

function extractTopComment(lines) {
  let started = false;
  const commentLines = [];
  for (let i = 0; i < Math.min(lines.length, 30); i += 1) {
    const line = lines[i].trim();
    if (!started && !line) continue;
    if (!started && (line.startsWith('/**') || line.startsWith('/*'))) {
      started = true;
      commentLines.push(lines[i]);
      if (line.endsWith('*/')) {
        return cleanComment(commentLines.join('\n'));
      }
      continue;
    }
    if (!started) {
      return '';
    }
    commentLines.push(lines[i]);
    if (line.endsWith('*/')) {
      return cleanComment(commentLines.join('\n'));
    }
  }
  return '';
}

function inferFilePurpose(relativePath, topComment) {
  if (topComment) return topComment;

  const normalized = relativePath.replace(/\\/g, '/');
  const base = path.basename(relativePath, path.extname(relativePath));
  const humanBase = humanizeIdentifier(base);

  if (normalized.startsWith('src/server/')) {
    return `Server-side module for ${humanBase}.`;
  }
  if (normalized.startsWith('src/services/api/')) {
    return `Model/API integration module for ${humanBase}.`;
  }
  if (normalized.startsWith('src/components/')) {
    return `UI component module for ${humanBase}.`;
  }
  if (normalized.startsWith('src/hooks/')) {
    return `Hook module for ${humanBase}.`;
  }
  if (normalized.startsWith('src/utils/')) {
    return `Utility module for ${humanBase}.`;
  }
  if (normalized.startsWith('desktop/src/pages/')) {
    return `Desktop page module for ${humanBase}.`;
  }
  if (normalized.startsWith('desktop/src/components/')) {
    return `Desktop UI component module for ${humanBase}.`;
  }
  if (normalized.startsWith('desktop/src/stores/')) {
    return `Desktop state store module for ${humanBase}.`;
  }
  return `Source module for ${humanBase}.`;
}

function inferSummary(name, kind, comment, filePath, container) {
  if (comment) return comment;

  const target = humanizeIdentifier(name);
  const componentPrefix = kind === 'component' ? 'React component that ' : '';
  const hookPrefix = kind === 'hook' ? 'Custom hook that ' : '';
  const methodPrefix = kind === 'method' && container ? `${container}.` : '';

  const prefixRules = [
    ['is', `returns whether ${target.replace(/^is /, '')}.`],
    ['has', `returns whether ${target.replace(/^has /, '')} is available.`],
    ['can', `returns whether ${target.replace(/^can /, '')}.`],
    ['should', `returns whether ${target.replace(/^should /, '')}.`],
    ['get', `retrieves ${target.replace(/^get /, '')}.`],
    ['set', `updates ${target.replace(/^set /, '')}.`],
    ['load', `loads ${target.replace(/^load /, '')}.`],
    ['read', `reads ${target.replace(/^read /, '')}.`],
    ['write', `writes ${target.replace(/^write /, '')}.`],
    ['save', `persists ${target.replace(/^save /, '')}.`],
    ['create', `creates ${target.replace(/^create /, '')}.`],
    ['build', `builds ${target.replace(/^build /, '')}.`],
    ['make', `builds ${target.replace(/^make /, '')}.`],
    ['render', `renders ${target.replace(/^render /, '')}.`],
    ['format', `formats ${target.replace(/^format /, '')}.`],
    ['parse', `parses ${target.replace(/^parse /, '')}.`],
    ['normalize', `normalizes ${target.replace(/^normalize /, '')}.`],
    ['convert', `converts ${target.replace(/^convert /, '')}.`],
    ['transform', `transforms ${target.replace(/^transform /, '')}.`],
    ['map', `maps ${target.replace(/^map /, '')}.`],
    ['merge', `merges ${target.replace(/^merge /, '')}.`],
    ['filter', `filters ${target.replace(/^filter /, '')}.`],
    ['handle', `handles ${target.replace(/^handle /, '')}.`],
    ['open', `opens ${target.replace(/^open /, '')}.`],
    ['close', `closes ${target.replace(/^close /, '')}.`],
    ['start', `starts ${target.replace(/^start /, '')}.`],
    ['stop', `stops ${target.replace(/^stop /, '')}.`],
    ['init', `initializes ${target.replace(/^init /, '')}.`],
    ['ensure', `ensures ${target.replace(/^ensure /, '')}.`],
    ['clear', `clears ${target.replace(/^clear /, '')}.`],
    ['reset', `resets ${target.replace(/^reset /, '')}.`],
    ['remove', `removes ${target.replace(/^remove /, '')}.`],
    ['delete', `deletes ${target.replace(/^delete /, '')}.`],
    ['increment', `increments ${target.replace(/^increment /, '')}.`],
    ['decrement', `decrements ${target.replace(/^decrement /, '')}.`],
    ['use', `manages ${target.replace(/^use /, '')} state and behavior.`],
  ];

  for (const [prefix, summary] of prefixRules) {
    if (name.startsWith(prefix) && name.length > prefix.length) {
      if (kind === 'component') return `${componentPrefix}${summary}`;
      if (kind === 'hook') return `${hookPrefix}${summary}`;
      return `${methodPrefix}${summary}`;
    }
  }

  if (name === 'constructor') {
    return 'Initializes the class instance.';
  }

  if (kind === 'component') {
    return `${componentPrefix}renders ${target}.`;
  }
  if (kind === 'hook') {
    return `${hookPrefix}exposes ${target}.`;
  }

  if (filePath.includes('/test') || filePath.includes('.test.')) {
    return `Implements test logic for ${target}.`;
  }

  return `${methodPrefix}implements ${target}.`;
}

function classifyKind(name, relativePath, explicitKind) {
  if (explicitKind) return explicitKind;
  if (name === 'constructor') return 'constructor';
  if (name.startsWith('use')) return 'hook';
  if (path.extname(relativePath) === '.tsx' && /^[A-Z]/.test(name)) return 'component';
  return 'function';
}

function extractSignature(lines, lineNumber) {
  const window = lines.slice(lineNumber - 1, lineNumber + 5).join('\n');
  let end = window.search(/\{|\=\>/);
  if (end === -1) {
    end = window.indexOf('\n');
  }
  if (end === -1) {
    end = window.length;
  }
  return normalizeWhitespace(window.slice(0, end + 2)).slice(0, 320);
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inSingle) {
      if (!escaped && char === "'") inSingle = false;
      escaped = !escaped && char === '\\';
      continue;
    }
    if (inDouble) {
      if (!escaped && char === '"') inDouble = false;
      escaped = !escaped && char === '\\';
      continue;
    }
    if (inTemplate) {
      if (!escaped && char === '`') inTemplate = false;
      escaped = !escaped && char === '\\';
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      escaped = false;
      continue;
    }
    if (char === '"') {
      inDouble = true;
      escaped = false;
      continue;
    }
    if (char === '`') {
      inTemplate = true;
      escaped = false;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return text.length - 1;
}

function extractClassRanges(text, lines, lineStarts) {
  const ranges = [];
  const classRegex = /^\s*(export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b[^{]*\{/gm;

  for (const match of text.matchAll(classRegex)) {
    const start = match.index ?? 0;
    const name = match[2];
    const openIndex = text.indexOf('{', start);
    if (openIndex === -1) continue;
    const end = findMatchingBrace(text, openIndex);
    ranges.push({
      name,
      start,
      end,
      line: lineOfOffset(lineStarts, start),
      exported: Boolean(match[1]),
      signature: normalizeWhitespace(text.slice(start, Math.min(openIndex + 1, start + 220))),
      comment: getLeadingComment(lines, lineOfOffset(lineStarts, start)),
    });
  }

  return ranges;
}

function findContainingClass(offset, classRanges) {
  for (const classRange of classRanges) {
    if (offset > classRange.start && offset < classRange.end) {
      return classRange.name;
    }
  }
  return '';
}

function extractEntries(text, relativePath) {
  const lines = splitLines(text);
  const lineStarts = computeLineStarts(lines);
  const classRanges = extractClassRanges(text, lines, lineStarts);
  const entries = [];
  const seen = new Set();

  const pushEntry = (entry) => {
    const key = `${entry.kind}:${entry.name}:${entry.line}:${entry.container || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  for (const classRange of classRanges) {
    pushEntry({
      name: classRange.name,
      kind: 'class',
      line: classRange.line,
      signature: classRange.signature,
      exported: classRange.exported,
      container: '',
      summary: inferSummary(classRange.name, 'class', classRange.comment, relativePath, ''),
    });
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const snippet = lines.slice(i, i + 6).join('\n');
    const offset = lineStarts[i];
    const container = findContainingClass(offset, classRanges);

    let match = snippet.match(/^[ \t]*(export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/);
    if (match) {
      const name = match[2];
      pushEntry({
        name,
        kind: classifyKind(name, relativePath),
        line: i + 1,
        signature: extractSignature(lines, i + 1),
        exported: Boolean(match[1]),
        container,
        summary: inferSummary(name, classifyKind(name, relativePath), getLeadingComment(lines, i + 1), relativePath, container),
      });
      continue;
    }

    match = line.match(/^[ \t]*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b[\s\S]*?=[ \t]*(.*)$/);
    if (match) {
      const rhsSnippet = [match[3], ...lines.slice(i + 1, i + 5)].join('\n');
      const startsLikeFunction =
        /^[ \t]*(?:async[ \t]+)?function\b/.test(rhsSnippet) ||
        /^[ \t]*(?:async[ \t]+)?(?:<[\s\S]{0,140}>\s*)?\([\s\S]{0,240}?\)\s*=>/.test(rhsSnippet) ||
        /^[ \t]*(?:async[ \t]+)?(?:<[\s\S]{0,140}>\s*)?[A-Za-z_$][\w$]*[ \t]*=>/.test(rhsSnippet);

      if (startsLikeFunction) {
        const name = match[2];
        const kind = classifyKind(name, relativePath);
        pushEntry({
          name,
          kind,
          line: i + 1,
          signature: extractSignature(lines, i + 1),
          exported: Boolean(match[1]),
          container,
          summary: inferSummary(name, kind, getLeadingComment(lines, i + 1), relativePath, container),
        });
        continue;
      }
    }

    if (!container) {
      continue;
    }

    match = snippet.match(
      /^[ \t]*(?:public\s+|private\s+|protected\s+|readonly\s+|override\s+|static\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*(?:<[\s\S]{0,140}>)?\s*\([\s\S]{0,240}?\)\s*(?::[\s\S]{0,160}?)?\s*\{/
    );
    if (match) {
      const name = match[1];
      const signaturePrefix = match[0].slice(0, match[0].indexOf('{'));
      if (KEYWORDS.has(name)) continue;
      if (name === 'class' || name === 'function') continue;
      if (signaturePrefix.includes('}') || signaturePrefix.includes('.')) continue;
      const kind = classifyKind(name, relativePath, container ? 'method' : 'function');
      pushEntry({
        name,
        kind,
        line: i + 1,
        signature: extractSignature(lines, i + 1),
        exported: false,
        container,
        summary: inferSummary(name, kind, getLeadingComment(lines, i + 1), relativePath, container),
      });
    }
  }

  entries.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return {
    topComment: extractTopComment(lines),
    classRanges,
    entries,
  };
}

function toGroupKey(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts[0] === 'desktop' && parts[1] === 'src') {
    return `desktop-${parts[2] || 'root'}`;
  }
  if (parts[0] === 'src') {
    return `src-${parts[1] || 'root'}`;
  }
  return normalized.replace(/\//g, '-');
}

function groupTitle(groupKey) {
  if (groupKey.startsWith('src-')) return `src/${groupKey.slice(4)}`;
  if (groupKey.startsWith('desktop-')) return `desktop/src/${groupKey.slice(8)}`;
  return groupKey;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function writeGroupMarkdown(groupKey, files) {
  const title = groupTitle(groupKey);
  const totalFunctions = files.reduce((sum, file) => sum + file.entries.length, 0);

  const sections = [
    `# ${title}`,
    '',
    `- Files: ${files.length}`,
    `- Named functions / methods / classes detected: ${totalFunctions}`,
    '',
  ];

  for (const file of files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    sections.push(`## ${file.relativePath}`);
    sections.push('');
    sections.push(`- Purpose: ${file.filePurpose}`);
    sections.push(`- Functions detected: ${file.entries.length}`);
    sections.push('');

    if (file.entries.length === 0) {
      sections.push('No named functions, methods, or classes were detected in this file.');
      sections.push('');
      continue;
    }

    for (const entry of file.entries) {
      sections.push(`### ${entry.container ? `${entry.container}.` : ''}${entry.name}`);
      sections.push('');
      sections.push(`- Kind: ${entry.kind}`);
      sections.push(`- Line: ${entry.line}`);
      sections.push(`- Exported: ${entry.exported ? 'yes' : 'no'}`);
      if (entry.container) {
        sections.push(`- Container: ${entry.container}`);
      }
      sections.push(`- Signature: \`${entry.signature}\``);
      sections.push(`- What it does: ${entry.summary}`);
      sections.push('');
    }
  }

  await fs.writeFile(path.join(GROUPS_ROOT, `${groupKey}.md`), sections.join('\n'), 'utf8');
}

async function main() {
  await ensureDir(GROUPS_ROOT);

  const files = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    const sourceFiles = await walk(sourceRoot.dir);
    for (const abs of sourceFiles) {
      const text = await fs.readFile(abs, 'utf8');
      const relativePath = path.relative(ROOT, abs).replace(/\\/g, '/');
      const { topComment, entries } = extractEntries(text, relativePath);
      files.push({
        relativePath,
        groupKey: toGroupKey(relativePath),
        filePurpose: inferFilePurpose(relativePath, topComment),
        entries,
      });
    }
  }

  const groups = new Map();
  for (const file of files) {
    if (!groups.has(file.groupKey)) groups.set(file.groupKey, []);
    groups.get(file.groupKey).push(file);
  }

  for (const [groupKey, groupFiles] of groups.entries()) {
    await writeGroupMarkdown(groupKey, groupFiles);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    projectRoot: ROOT,
    totalFiles: files.length,
    totalEntries: files.reduce((sum, file) => sum + file.entries.length, 0),
    groups: Array.from(groups.entries())
      .map(([groupKey, groupFiles]) => ({
        groupKey,
        title: groupTitle(groupKey),
        fileCount: groupFiles.length,
        entryCount: groupFiles.reduce((sum, file) => sum + file.entries.length, 0),
        output: `generated/groups/${groupKey}.md`,
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };

  const moduleMap = [
    '# Module Map',
    '',
    `Generated at: ${manifest.generatedAt}`,
    '',
    `- Total files analyzed: ${manifest.totalFiles}`,
    `- Total named functions / methods / classes detected: ${manifest.totalEntries}`,
    '',
    '## Groups',
    '',
    ...manifest.groups.flatMap((group) => [
      `### ${group.title}`,
      '',
      `- Files: ${group.fileCount}`,
      `- Entries: ${group.entryCount}`,
      `- Detail file: [${group.output}](./${group.output.replace(/^generated\//, '')})`,
      '',
    ]),
  ];

  const csvLines = [
    [
      'kind',
      'name',
      'container',
      'file',
      'line',
      'exported',
      'signature',
      'summary',
    ].join(','),
  ];

  for (const file of files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    for (const entry of file.entries) {
      csvLines.push(
        [
          entry.kind,
          entry.name,
          entry.container,
          file.relativePath,
          entry.line,
          entry.exported,
          entry.signature,
          entry.summary,
        ]
          .map(csvEscape)
          .join(',')
      );
    }
  }

  await fs.writeFile(path.join(GENERATED_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await fs.writeFile(path.join(GENERATED_ROOT, 'module-map.md'), moduleMap.join('\n'), 'utf8');
  await fs.writeFile(path.join(GENERATED_ROOT, 'function-index.csv'), csvLines.join('\n'), 'utf8');
}

main().catch((error) => {
  console.error('[generate-analysis] failed:', error);
  process.exitCode = 1;
});
