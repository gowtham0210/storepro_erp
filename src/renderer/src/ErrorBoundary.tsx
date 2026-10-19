import { TriangleAlert } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './components/ui/Button'
import { EmptyState } from './components/ui/EmptyState'
import { serialiseError, reportToMain } from './lib/errorReporting'

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
}

/** Keeps a rendering bug from leaving the cashier with a blank window. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportToMain('error', 'React render error', {
      ...serialiseError(error),
      componentStack: info.componentStack ?? null
    })
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <main role="alert" className="flex h-screen items-center justify-center bg-canvas">
        <EmptyState
          icon={<TriangleAlert />}
          title="Something went wrong on this screen"
          description="Your saved data is safe. The details were recorded for support. Reload to continue."
          action={
            <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
              Reload StorePro
            </Button>
          }
        />
      </main>
    )
  }
}
