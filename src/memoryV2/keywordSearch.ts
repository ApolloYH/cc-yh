export function semanticTerms(value: string): string[] {
  const tokens = value
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]+/gu) ?? []
  const expanded = tokens.flatMap(token => {
    if (token.length <= 1) return []
    const synonyms: Record<string, string[]> = {
      browser: ['chrome', 'tab', 'cdp', 'tmwd'],
      chrome: ['browser', 'tab', 'cdp'],
      memory: ['remember', 'recall', 'knowledge'],
      skill: ['workflow', 'sop', 'procedure'],
      test: ['verify', 'validation', 'check'],
      error: ['failure', 'bug', 'exception'],
      search: ['find', 'lookup', 'query'],
      浏览器: ['browser', 'chrome', 'tab'],
      记忆: ['memory', 'remember', 'recall'],
      技能: ['skill', 'workflow', 'sop'],
      测试: ['test', 'verify', 'check'],
      搜索: ['search', 'find', 'query'],
    }
    return [token, ...(synonyms[token] ?? []), ...cjkBigrams(token)]
  })
  return Array.from(new Set(expanded))
}

export function keywordScore(query: string, text: string): {
  score: number
  matchedTerms: string[]
} {
  const normalizedQuery = query.normalize('NFKC').toLowerCase().trim()
  const normalizedText = text.normalize('NFKC').toLowerCase()
  const queryTerms = semanticTerms(normalizedQuery)
  const textTerms = new Set(semanticTerms(normalizedText))
  const matchedTerms = queryTerms.filter(term => textTerms.has(term) || normalizedText.includes(term))
  let score = matchedTerms.length / Math.max(queryTerms.length, 1)
  if (normalizedQuery && normalizedText.includes(normalizedQuery)) score += 2
  return { score, matchedTerms }
}

function cjkBigrams(value: string): string[] {
  const chars = Array.from(value)
  if (chars.length < 2) return []
  const hasCjk = chars.some(char => /\p{Script=Han}/u.test(char))
  if (!hasCjk) return []
  const result: string[] = []
  for (let index = 0; index < chars.length - 1; index += 1) {
    result.push(chars.slice(index, index + 2).join(''))
  }
  return result
}
