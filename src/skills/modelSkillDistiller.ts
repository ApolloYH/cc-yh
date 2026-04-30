import type { MemoryV2DistillCandidate } from '../memoryV2/types.js'
import {
  callConfiguredMainModel,
  parseJsonFromModelText,
} from '../services/model/mainModelClient.js'

export type SkillSuccessJudgement = {
  successful: boolean
  reusable: boolean
  confidence: number
  reasons: string[]
  verifier: 'model' | 'heuristic'
}

export type ModelSkillRewriteResult = {
  markdown: string
  judgement: SkillSuccessJudgement
  modelUsed: boolean
}

export async function rewriteSkillWithModelOrHeuristic(params: {
  candidate: MemoryV2DistillCandidate
  fallbackMarkdown: string
  name: string
  version: string
}): Promise<ModelSkillRewriteResult> {
  const heuristic = judgeSkillCandidateSuccess(params.candidate)
  const model = await callSkillDistillModel(params).catch(() => null)
  if (model?.judgement) {
    return {
      markdown: model.markdown
        ? normalizeModelMarkdown(model.markdown, params.name, params.version)
        : polishFallbackMarkdown(params.fallbackMarkdown),
      judgement: {
        ...model.judgement,
        verifier: 'model',
        confidence: Math.max(0, Math.min(0.99, model.judgement.confidence)),
      },
      modelUsed: true,
    }
  }

  if (!heuristic.successful || !heuristic.reusable) {
    return {
      markdown: params.fallbackMarkdown,
      judgement: heuristic,
      modelUsed: false,
    }
  }

  if (!model?.markdown) {
    return {
      markdown: polishFallbackMarkdown(params.fallbackMarkdown),
      judgement: heuristic,
      modelUsed: false,
    }
  }

  return {
    markdown: normalizeModelMarkdown(model.markdown, params.name, params.version),
    judgement: {
      ...heuristic,
      verifier: 'model',
      confidence: Math.max(heuristic.confidence, model.confidence ?? heuristic.confidence),
      reasons: [
        ...heuristic.reasons,
        'Model rewrite returned a structured SKILL.md candidate.',
      ],
    },
    modelUsed: true,
  }
}

export function judgeSkillCandidateSuccess(
  candidate: MemoryV2DistillCandidate,
): SkillSuccessJudgement {
  const text = `${candidate.title}\n${candidate.reason}\n${candidate.content}`.toLowerCase()
  const negative = [
    /\bfailed\b/,
    /\bfailure\b/,
    /\bblocked\b/,
    /\bcould not\b/,
    /\bunable\b/,
    /\bnot solved\b/,
    /\berror only\b/,
    /失败/,
    /无法完成/,
    /未解决/,
  ]
  const positive = [
    /\bverified\b/,
    /\bpassed\b/,
    /\bsuccess\b/,
    /\bcompleted\b/,
    /\bworks?\b/,
    /\bregression\b/,
    /\btested\b/,
    /已验证/,
    /通过/,
    /成功/,
    /可复用/,
    /回归测试/,
  ]
  const reusable = [
    /\bsop\b/,
    /\bworkflow\b/,
    /\bprocedure\b/,
    /\bsteps?\b/,
    /\bwhen to use\b/,
    /流程/,
    /步骤/,
    /沉淀/,
  ]

  const hasNegative = negative.some(pattern => pattern.test(text))
  const positiveHits = positive.filter(pattern => pattern.test(text)).length
  const reusableHits = reusable.filter(pattern => pattern.test(text)).length
  const confidence = Math.max(
    0,
    Math.min(0.98, candidate.confidence + positiveHits * 0.06 + reusableHits * 0.04 - (hasNegative ? 0.45 : 0)),
  )

  return {
    successful: !hasNegative && positiveHits > 0 && confidence >= 0.7,
    reusable: candidate.layer === 'L3' && reusableHits > 0,
    confidence,
    verifier: 'heuristic',
    reasons: [
      hasNegative ? 'Negative completion signal found.' : 'No failure signal found.',
      `${positiveHits} success signal(s), ${reusableHits} reusable workflow signal(s).`,
      `Candidate confidence ${candidate.confidence}.`,
    ],
  }
}

function polishFallbackMarkdown(markdown: string): string {
  return markdown
    .replace('## Failure And Stop Conditions', '## Stop Conditions')
    .replace('Do not convert a failed attempt into memory or another skill.', 'Only reuse this skill after the workflow has been verified in the current context.')
}

async function callSkillDistillModel(params: {
  candidate: MemoryV2DistillCandidate
  fallbackMarkdown: string
  name: string
  version: string
}): Promise<{
  markdown?: string
  confidence?: number
  judgement?: SkillSuccessJudgement
} | null> {
  const mainModel = await callConfiguredMainModel({
    maxTokens: 2200,
    systemPrompt: [
      'You judge whether an execution memory should become a reusable claude-yh Skill.',
      'Then rewrite it into a concise production SKILL.md only when it is successful and reusable.',
      'Return JSON only with this shape:',
      '{"successful":true,"reusable":true,"confidence":0.0,"reasons":["..."],"markdown":"..."}',
      'Do not invent capabilities. Failed, blocked, login/captcha/payment, or unverified attempts must be successful=false or reusable=false.',
    ].join(' '),
    userPrompt: JSON.stringify({
      name: params.name,
      version: params.version,
      candidate: params.candidate,
      fallbackMarkdown: params.fallbackMarkdown,
    }),
  }).catch(() => null)
  const mainParsed = mainModel ? parseSkillModelPayload(parseJsonFromModelText(mainModel.content)) : null
  if (mainParsed) return mainParsed

  const endpoint = process.env.CLAUDE_YH_SKILL_MODEL_ENDPOINT?.trim()
  const apiKey = process.env.CLAUDE_YH_SKILL_MODEL_API_KEY?.trim()
  const model = process.env.CLAUDE_YH_SKILL_MODEL?.trim() || 'claude-yh-skill-distiller'
  if (!endpoint) return null

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: [
            'Rewrite verified execution experience into a concise production SKILL.md.',
            'Return JSON only: {"markdown":"...","confidence":0.0-1.0}.',
            'Do not invent capabilities. Keep stop conditions explicit.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            name: params.name,
            version: params.version,
            candidate: params.candidate,
            fallbackMarkdown: params.fallbackMarkdown,
          }),
        },
      ],
    }),
  })

  if (!response.ok) return null
  const payload = await response.json() as Record<string, unknown>
  const direct = parseSkillModelPayload(payload)
  if (direct) return direct

  const content = Array.isArray(payload.choices)
    ? ((payload.choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content)
    : undefined
  if (typeof content !== 'string') return null
  try {
    return parseSkillModelPayload(JSON.parse(content) as Record<string, unknown>)
  } catch {
    return { markdown: content }
  }
}

function parseSkillModelPayload(payload: Record<string, unknown> | null): {
  markdown?: string
  confidence?: number
  judgement?: SkillSuccessJudgement
} | null {
  if (!payload) return null
  const markdown = typeof payload.markdown === 'string' && payload.markdown.trim()
    ? payload.markdown
    : undefined
  const confidence = typeof payload.confidence === 'number'
    ? payload.confidence
    : undefined
  const hasJudgement =
    typeof payload.successful === 'boolean' ||
    typeof payload.reusable === 'boolean' ||
    typeof payload.confidence === 'number'
  if (!markdown && !hasJudgement) return null

  const reasons = Array.isArray(payload.reasons)
    ? payload.reasons.filter((reason): reason is string => typeof reason === 'string')
    : []

  return {
    ...(markdown ? { markdown } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(hasJudgement
      ? {
          judgement: {
            successful: payload.successful === true,
            reusable: payload.reusable === true,
            confidence: confidence ?? 0.5,
            verifier: 'model' as const,
            reasons: reasons.length > 0 ? reasons : ['Model judgement returned without reasons.'],
          },
        }
      : {}),
  }
}

function normalizeModelMarkdown(markdown: string, name: string, version: string): string {
  const trimmed = markdown.trim()
  if (trimmed.startsWith('---')) return `${trimmed}\n`
  return [
    '---',
    `name: ${name}`,
    `version: "${version}"`,
    'description: "Use this verified workflow when the current task matches its source conditions."',
    'user-invocable: true',
    '---',
    '',
    trimmed,
    '',
  ].join('\n')
}
