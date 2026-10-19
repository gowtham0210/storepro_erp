import { useEffect, type ReactNode } from 'react'

interface AuthLayoutProps {
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}

/** The calm, centred frame for sign-in, setup, lock and password screens. */
export function AuthLayout({
  title,
  description,
  children,
  footer
}: AuthLayoutProps): React.JSX.Element {
  useEffect(() => {
    document.title = `${title} · StorePro`
  }, [title])
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <main className="w-full max-w-md">
        <p className="on-dark mb-6 inline-flex rounded-md bg-nav px-3 py-1.5 text-lg font-bold text-fg-inverse">
          StorePro
        </p>
        <div className="rounded-lg border border-divider bg-surface p-8 shadow-sm">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && <div className="mt-1 text-fg-muted">{description}</div>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-sm text-fg-muted">{footer}</div>}
      </main>
    </div>
  )
}
