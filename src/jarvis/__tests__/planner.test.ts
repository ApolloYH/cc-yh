import { describe, expect, it } from 'bun:test'
import { normalizeJarvisPlanSteps } from '../planner.js'

describe('Jarvis planner', () => {
  it('keeps simple conversational goals as one queue item', () => {
    const steps = normalizeJarvisPlanSteps('自我介绍', [
      '以简洁友好的方式介绍自己',
      '说明自己的核心能力和用途',
      '说明自己在当前对话环境中的角色',
    ])

    expect(steps).toEqual(['自我介绍'])
  })

  it('keeps status queries as one queue item', () => {
    const steps = normalizeJarvisPlanSteps('查询当前任务状态', [
      '检查当前任务队列状态',
      '返回任务列表或空闲状态',
    ])

    expect(steps).toEqual(['查询当前任务状态'])
  })

  it('follows native Claude criteria by not splitting fewer than 3 actions', () => {
    const steps = normalizeJarvisPlanSteps('修复登录按钮样式并验证结果', [
      '修复登录按钮样式',
      '验证结果',
    ])

    expect(steps).toEqual(['修复登录按钮样式并验证结果'])
  })

  it('keeps genuinely staged goals split', () => {
    const steps = normalizeJarvisPlanSteps('持续观察这个项目，发现失败任务就分析原因并尝试修复', [
      '检查最近失败任务和日志',
      '分析失败原因',
      '尝试低风险修复',
      '运行验证并汇报结果',
    ])

    expect(steps).toHaveLength(4)
  })
})
