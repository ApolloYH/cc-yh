import type { Command, LocalCommandCall } from '../types/command.js'
import { PRODUCT_DISPLAY_NAME, PRODUCT_DISPLAY_VERSION } from '../utils/branding.js'

const call: LocalCommandCall = async () => {
  return {
    type: 'text',
    value: MACRO.BUILD_TIME
      ? `${PRODUCT_DISPLAY_VERSION} (${PRODUCT_DISPLAY_NAME}, built ${MACRO.BUILD_TIME})`
      : PRODUCT_DISPLAY_VERSION,
  }
}

const version = {
  type: 'local',
  name: 'version',
  description:
    'Print the version this session is running (not what autoupdate downloaded)',
  isEnabled: () => process.env.USER_TYPE === 'ant',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default version
