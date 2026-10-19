import { Compass, Lock, Puzzle } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'

export function NotFoundPage(): React.JSX.Element {
  const navigate = useNavigate()
  return (
    <>
      <PageHeader title="Page not found" />
      <Card>
        <EmptyState
          icon={<Compass />}
          title="There's nothing at this address"
          description="Use the menu on the left, or go back to billing."
          action={
            <Button variant="primary" onClick={() => navigate('/billing')}>
              Go to Billing
            </Button>
          }
        />
      </Card>
    </>
  )
}

/** For a role that can open no screen at all: nothing is broken, they just need access. */
export function NoScreensPage(): React.JSX.Element {
  return (
    <>
      <PageHeader title="Welcome" />
      <Card>
        <EmptyState
          icon={<Lock />}
          title="Your role doesn't include any screens yet"
          description="Ask a manager or administrator to give you the access you need."
        />
      </Card>
    </>
  )
}

/** A module's screen, opened while the module is switched off (M04). */
export function ModuleOffPage({
  screen,
  module
}: {
  screen: string
  module: string
}): React.JSX.Element {
  return (
    <>
      <PageHeader title={screen} />
      <Card>
        <EmptyState
          icon={<Puzzle />}
          title={`${screen} is part of the ${module} module, which is switched off`}
          description="An administrator can switch modules on in Settings. Switching a module off never deletes its data."
        />
      </Card>
    </>
  )
}

export function AccessDeniedPage({ screen }: { screen: string }): React.JSX.Element {
  return (
    <>
      <PageHeader title={screen} />
      <Card>
        <EmptyState
          icon={<Lock />}
          title={`You don't have access to ${screen}`}
          description="Ask a manager or administrator if you need it."
        />
      </Card>
    </>
  )
}
