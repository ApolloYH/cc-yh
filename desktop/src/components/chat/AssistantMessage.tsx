import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { MessageActionBar } from './MessageActionBar'
import { InlineImageGallery } from './InlineImageGallery'

type Props = {
  content: string
  isStreaming?: boolean
}

export function AssistantMessage({ content, isStreaming }: Props) {
  return (
    <div className="group mb-8 flex items-end gap-2">
      <div className="min-w-0 max-w-full flex-1 px-1 py-1 text-[15px] leading-7 text-[var(--color-text-primary)]">
        <MarkdownRenderer content={content} className="prose-p:leading-7 prose-p:text-[15px] prose-li:text-[15px]" />
        {!isStreaming && <InlineImageGallery text={content} />}
        {isStreaming && (
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-shimmer bg-[var(--color-brand)] align-text-bottom" />
        )}
      </div>

      <MessageActionBar
        copyText={isStreaming ? undefined : content}
        copyLabel="Copy reply"
      />
    </div>
  )
}
