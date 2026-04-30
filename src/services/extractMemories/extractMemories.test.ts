import { afterEach, describe, expect, it } from 'bun:test'
import * as path from 'node:path'
import { getAutoMemPath } from '../../memdir/paths.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { createAutoMemCanUseTool } from './extractMemories.js'

describe('createAutoMemCanUseTool', () => {
  afterEach(() => {
    delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
    getAutoMemPath.cache.clear?.()
  })

  it('can enforce L1-L4 write locations for the extraction agent', async () => {
    const memoryDir = path.join(process.cwd(), '.test-memory')
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = memoryDir
    getAutoMemPath.cache.clear?.()
    const canUseTool = createAutoMemCanUseTool(memoryDir, {
      enforceLayeredWrites: true,
    })
    const tool = {
      name: FILE_WRITE_TOOL_NAME,
    } as any

    const allowed = await (canUseTool as any)(tool, {
      file_path: path.join(memoryDir, 'facts', 'provider.md'),
    })
    const denied = await (canUseTool as any)(tool, {
      file_path: path.join(memoryDir, 'provider.md'),
    })

    expect(allowed.behavior).toBe('allow')
    expect(denied.behavior).toBe('deny')
  })
})
