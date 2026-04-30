type Props = {
  workDir?: string | null
  repoName?: string | null
  branch?: string | null
  variant?: 'chip' | 'headline'
  showFullPath?: boolean
}

function getWorkDirName(workDir?: string | null): string {
  if (!workDir) return ''
  const parts = workDir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

export function ProjectContextChip({
  workDir,
  repoName,
  branch,
  variant = 'chip',
  showFullPath = false,
}: Props) {
  const label = showFullPath
    ? (workDir || repoName || '')
    : branch
      ? (repoName || getWorkDirName(workDir) || '')
      : (getWorkDirName(workDir) || repoName || '')

  if (!label) return null

  if (variant === 'headline') {
    return (
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="material-symbols-outlined text-[24px] text-[var(--color-text-secondary)]">folder_open</span>
          <h1
            className="truncate text-[26px] font-semibold leading-tight text-[var(--color-text-primary)]"
            style={{ fontFamily: "'Inter', sans-serif" }}
            title={label}
          >
            {label}
          </h1>
        </div>
        {(repoName || branch) && (
          <div className="mt-2 flex min-w-0 items-center gap-2 pl-[36px] text-sm text-[var(--color-text-secondary)]">
            {repoName && !showFullPath && <span className="truncate">{repoName}</span>}
            {repoName && branch && <span className="text-[var(--color-text-tertiary)]">/</span>}
            {branch && <span className="truncate">{branch}</span>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] bg-[var(--color-surface-container-lowest)]">
      {branch ? (
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-[var(--color-text-secondary)]">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
      ) : (
        <span className="material-symbols-outlined text-[18px] text-[var(--color-text-secondary)]">folder</span>
      )}
      <span className="truncate font-medium text-[var(--color-text-primary)]">{label}</span>
      {branch ? (
        <>
          <span className="text-[var(--color-text-tertiary)]">|</span>
          <span className="truncate">{branch}</span>
        </>
      ) : null}
    </div>
  )
}
