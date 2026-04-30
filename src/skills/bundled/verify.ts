import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { registerBundledSkill } from '../bundledSkills.js'
import { SKILL_FILES, SKILL_MD } from './verifyContent.js'

const { frontmatter, content: SKILL_BODY } = parseFrontmatter(SKILL_MD)

const DESCRIPTION =
  typeof frontmatter.description === 'string'
    ? frontmatter.description
    : 'Verify a code change does what it should by running the app.'

export function registerVerifySkill(): void {
  registerBundledSkill({
    name: 'verify',
    description: DESCRIPTION,
    userInvocable: true,
    files: SKILL_FILES,
    async getPromptForCommand(args) {
      const parts: string[] = [
        [
          'Use this verification SOP for claude-yh tasks.',
          'Do not mark work complete from static inspection alone when a relevant command, app interaction, browser smoke test, or tool-level check is available.',
          'Return PASS, PARTIAL, or FAIL with the concrete evidence, commands, screenshots, DOM/tool results, or remaining risk.',
        ].join('\n'),
        SKILL_BODY.trimStart(),
      ]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
