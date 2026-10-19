import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

/** Every status colour comes with an icon so meaning never depends on colour alone. */
export const TONE_ICONS: Record<Tone, ReactNode> = {
  info: <Info aria-hidden />,
  success: <CircleCheck aria-hidden />,
  warning: <TriangleAlert aria-hidden />,
  danger: <CircleAlert aria-hidden />,
  neutral: <Info aria-hidden />
}

export const TONE_SOFT: Record<Tone, string> = {
  info: 'bg-accent-soft text-accent-fg border-accent/40',
  success: 'bg-success-soft text-success-fg border-success/40',
  warning: 'bg-warning-soft text-warning-fg border-warning/40',
  danger: 'bg-danger-soft text-danger-fg border-danger/40',
  neutral: 'bg-surface-muted text-fg border-divider'
}
