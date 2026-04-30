import {
  buildSearchingPastContextSection,
  DIRS_EXIST_GUIDANCE,
  ENTRYPOINT_NAME,
} from './memdir.js'
import {
  LAYERED_MEMORY_SECTION,
  MEMORY_DRIFT_CAVEAT,
  TRUSTING_RECALL_SECTION,
  TYPES_SECTION_COMBINED,
  WHAT_NOT_TO_SAVE_SECTION,
} from './memoryTypes.js'
import { getAutoMemPath } from './paths.js'
import { getTeamMemPath } from './teamMemPaths.js'

/**
 * Build the combined prompt when both auto memory and team memory are enabled.
 * Closed four-type taxonomy (user / feedback / project / reference) with
 * per-type <scope> guidance embedded in XML-style <type> blocks.
 */
export function buildCombinedMemoryPrompt(
  extraGuidelines?: string[],
  _skipIndex = false,
): string {
  const autoDir = getAutoMemPath()
  const teamDir = getTeamMemPath()

  const howToSave = [
    '## How memory is updated',
    '',
    'Long-term memory is updated by MemoryV2 automation, not by direct Write/Edit calls in the main conversation.',
    '',
    '- Do not write, edit, delete, or append files under either memory directory during normal chat.',
    `- Do not manually edit \`${ENTRYPOINT_NAME}\`; L1 is regenerated from the complete L2/L3 set after automated extraction.`,
    '- If the user explicitly asks you to remember or forget something, state the durable fact, preference, or procedure plainly in your reply so the session finalizer can extract it from L4.',
    '- The MemoryV2 finalizer writes stable facts to `facts/`, SOPs to `sops/`, and claude-yh Skills to `sops/skills/` through supported services.',
    '- Use `/memory` or the settings Memory page when the user wants to inspect or manually edit memory through the supported API.',
  ]

  const lines = [
    '# Memory',
    '',
    `You have a persistent, file-based memory system with two directories: a private directory at \`${autoDir}\` and a shared team directory at \`${teamDir}\`. ${DIRS_EXIST_GUIDANCE}`,
    '',
    "You should build up this memory system over time so that future conversations can have a complete picture of who the user is, how they'd like to collaborate with you, what behaviors to avoid or repeat, and the context behind the work the user gives you.",
    '',
    'If the user explicitly asks you to remember or forget something, acknowledge the intended durable change in plain language. Do not modify memory files directly; MemoryV2 will extract and apply eligible L2/L3 changes from the conversation.',
    '',
    ...LAYERED_MEMORY_SECTION,
    '## Memory scope',
    '',
    'There are two scope levels:',
    '',
    `- private: memories that are private between you and the current user. They persist across conversations with only this specific user and are stored at the root \`${autoDir}\`.`,
    `- team: memories that are shared with and contributed by all of the users who work within this project directory. Team memories are synced at the beginning of every session and they are stored at \`${teamDir}\`.`,
    '',
    ...TYPES_SECTION_COMBINED,
    ...WHAT_NOT_TO_SAVE_SECTION,
    '- You MUST avoid saving sensitive data within shared team memories. For example, never save API keys or user credentials.',
    '',
    ...howToSave,
    '',
    '## When to access memories',
    '- When memories (personal or team) seem relevant, or the user references prior work with them or others in their organization.',
    '- You MUST access memory when the user explicitly asks you to check, recall, or remember.',
    '- If the user says to *ignore* or *not use* memory: proceed as if MEMORY.md were empty. Do not apply remembered facts, cite, compare against, or mention memory content.',
    MEMORY_DRIFT_CAVEAT,
    '',
    ...TRUSTING_RECALL_SECTION,
    '',
    '## Memory and other forms of persistence',
    'Memory is one of several persistence mechanisms available to you as you assist the user in a given conversation. The distinction is often that memory can be recalled in future conversations and should not be used for persisting information that is only useful within the scope of the current conversation.',
    '- When to use or update a plan instead of memory: If you are about to start a non-trivial implementation task and would like to reach alignment with the user on your approach you should use a Plan rather than saving this information to memory. Similarly, if you already have a plan within the conversation and you have changed your approach persist that change by updating the plan rather than saving a memory.',
    '- When to use or update tasks instead of memory: When you need to break your work in current conversation into discrete steps or keep track of your progress use tasks instead of saving to memory. Tasks are great for persisting information about the work that needs to be done in the current conversation, but memory should be reserved for information that will be useful in future conversations.',
    ...(extraGuidelines ?? []),
    '',
    ...buildSearchingPastContextSection(autoDir),
  ]

  return lines.join('\n')
}
