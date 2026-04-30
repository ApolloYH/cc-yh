import { describe, expect, it } from 'bun:test'
import { buildJarvisManagerPrompt } from '../taskEnvelope.js'
import type { JarvisQueueItem } from '../queue.js'

describe('Jarvis manager task envelope', () => {
  it('does not contain Jarvis-side task breakdown steps', () => {
    const item: JarvisQueueItem = {
      id: 'task-1',
      title: '研究项目',
      goal: '研究这个项目并给出改进建议',
      prompt: '研究这个项目并给出改进建议',
      lane: 'read_only',
      permissionMode: 'autonomous',
      priority: 70,
      status: 'pending',
      approvalState: 'none',
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const prompt = buildJarvisManagerPrompt(item)

    expect(prompt).toContain('"taskId": "task-1"')
    expect(prompt).toContain('"originalGoal": "研究这个项目并给出改进建议"')
    expect(prompt).not.toContain('"steps"')
    expect(prompt).not.toContain('Step 1/')
  })
})
