import { useEffect, type ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
}

/**
 * The page's single <h1>. It also sets the window title and is the focus
 * target after navigation (so screen readers announce the new page).
 */
export function PageHeader({ title, description, actions }: PageHeaderProps): React.JSX.Element {
  useEffect(() => {
    document.title = `${title} · StorePro`
  }, [title])
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 tabIndex={-1} data-page-heading className="text-2xl font-semibold outline-none">
          {title}
        </h1>
        {description && <p className="mt-1 text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
