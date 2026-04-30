import type { UIAttachment } from '../../types/chat'
import { AttachmentGallery } from './AttachmentGallery'
import { MessageActionBar } from './MessageActionBar'

type Props = {
  content: string
  attachments?: UIAttachment[]
}

export function UserMessage({ content, attachments }: Props) {
  const hasText = content.trim().length > 0

  return (
    <div className="group mb-7 flex items-end justify-end gap-2">
      <div className="min-w-0 max-w-[72%] space-y-2">
        {attachments && attachments.length > 0 && (
          <AttachmentGallery attachments={attachments} variant="message" />
        )}

        {hasText && (
          <div className="rounded-[26px] bg-[var(--color-surface-user-msg)] px-5 py-3 text-[15px] leading-7 text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
            {content}
          </div>
        )}
      </div>

      {hasText && (
        <MessageActionBar
          copyText={content}
          copyLabel="Copy prompt"
        />
      )}
    </div>
  )
}
