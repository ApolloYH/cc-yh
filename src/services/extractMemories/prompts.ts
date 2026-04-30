/**
 * Prompt templates for the background memory extraction agent.
 *
 * The extraction agent runs as a fork of the main conversation. It only writes
 * durable memory files; L1/MEMORY.md is regenerated mechanically from L2/L3.
 */

import { feature } from 'bun:bundle'
import {
  LAYERED_MEMORY_SECTION,
  MEMORY_FRONTMATTER_EXAMPLE,
  TYPES_SECTION_COMBINED,
  TYPES_SECTION_INDIVIDUAL,
  WHAT_NOT_TO_SAVE_SECTION,
} from '../../memdir/memoryTypes.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../../tools/GrepTool/prompt.js'

function opener(newMessageCount: number, existingMemories: string): string {
  const manifest =
    existingMemories.length > 0
      ? `\n\n## Existing memory files\n\n${existingMemories}\n\nCheck this list before writing. Update an existing file rather than creating a duplicate.`
      : ''
  return [
    `You are now acting as the memory extraction subagent. Analyze the most recent ~${newMessageCount} messages above and use them to update the global persistent memory system.`,
    '',
    `Available tools: ${FILE_READ_TOOL_NAME}, ${GREP_TOOL_NAME}, ${GLOB_TOOL_NAME}, read-only ${BASH_TOOL_NAME} (ls/find/cat/stat/wc/head/tail and similar), and ${FILE_EDIT_TOOL_NAME}/${FILE_WRITE_TOOL_NAME} for paths inside the memory directory only. ${BASH_TOOL_NAME} rm is not permitted. All other tools, including MCP, Agent, and write-capable ${BASH_TOOL_NAME}, will be denied.`,
    '',
    `You have a limited turn budget. ${FILE_EDIT_TOOL_NAME} requires a prior ${FILE_READ_TOOL_NAME} of the same file, so the efficient strategy is: turn 1 read every file you might update in parallel; turn 2 issue all ${FILE_WRITE_TOOL_NAME}/${FILE_EDIT_TOOL_NAME} calls in parallel. Do not interleave reads and writes across multiple turns.`,
    '',
    `You MUST only use content from the last ~${newMessageCount} messages to update persistent memories. Do not investigate or verify the codebase further. No grepping source files, no reading code to confirm a pattern exists, no git commands.` +
      manifest,
  ].join('\n')
}

function buildHowToSave(chosenMemoryDirectory = 'the global memory directory'): string[] {
  return [
    '## How to save memories',
    '',
    'Saving memory means updating L2/L3 files. Do not append pointer lists to L1 and do not edit `MEMORY.md` directly.',
    '',
    ...MEMORY_FRONTMATTER_EXAMPLE,
    '',
    '- Organize memory semantically by topic, not chronologically.',
    `- Save stable L2 facts under \`facts/\` inside ${chosenMemoryDirectory}.`,
    `- Save verified L3 SOP procedures under \`sops/\` inside ${chosenMemoryDirectory}.`,
    '- Save claude-yh Skills under `sops/skills/<skill-name>/SKILL.md`.',
    '- L1 is regenerated from the complete L2/L3 set after extraction as role positioning, user preferences, and compressed summaries of L2/L3. Never write L1 manually.',
    '- For each reusable workflow, choose exactly ONE L3 shape: SOP OR Skill. Do not save the same workflow in both `sops/*.md` and `sops/skills/*/SKILL.md`.',
    '- Choose Skill when the model should actively recognize and invoke the capability in future conversations, especially when it has clear triggers, tools, constraints, and step-by-step operating instructions.',
    '- Choose SOP when it is ordinary project/process knowledge, troubleshooting notes, or a reusable checklist that should be retrieved as memory but not exposed as a model-invocable skill.',
    '- If a Skill already exists for the workflow, update that Skill instead of creating a parallel SOP. If an SOP already exists but the workflow is better as a Skill, migrate/update the Skill and remove or replace the SOP.',
    '- Low-value small talk, one-off tests, failed attempts, vague requests, and task titles without reusable execution knowledge must not be promoted.',
    '- Update or remove memories that turn out to be wrong or outdated.',
    '- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.',
  ]
}

export function buildExtractAutoOnlyPrompt(
  newMessageCount: number,
  existingMemories: string,
  _skipIndex = false,
): string {
  return [
    opener(newMessageCount, existingMemories),
    '',
    'If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.',
    '',
    ...LAYERED_MEMORY_SECTION,
    ...TYPES_SECTION_INDIVIDUAL,
    ...WHAT_NOT_TO_SAVE_SECTION,
    '',
    ...buildHowToSave('the global memory directory'),
  ].join('\n')
}

export function buildExtractCombinedPrompt(
  newMessageCount: number,
  existingMemories: string,
  skipIndex = false,
): string {
  if (!feature('TEAMMEM')) {
    return buildExtractAutoOnlyPrompt(
      newMessageCount,
      existingMemories,
      skipIndex,
    )
  }

  return [
    opener(newMessageCount, existingMemories),
    '',
    'If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.',
    '',
    ...LAYERED_MEMORY_SECTION,
    ...TYPES_SECTION_COMBINED,
    ...WHAT_NOT_TO_SAVE_SECTION,
    '- You MUST avoid saving sensitive data within shared team memories. For example, never save API keys or user credentials.',
    '',
    ...buildHowToSave('the chosen memory directory'),
  ].join('\n')
}
