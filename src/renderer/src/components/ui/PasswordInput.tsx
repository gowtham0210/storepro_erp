import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useId, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react'
import { cx } from '../../lib/cx'
import { controlClasses } from './Field'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/**
 * Password entry with a show/hide toggle and a Caps Lock warning, the two
 * most common reasons a correct password is "wrong".
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    { className, onKeyDown, onKeyUp, 'aria-describedby': describedBy, ...rest },
    ref
  ) {
    const [visible, setVisible] = useState(false)
    const [capsLock, setCapsLock] = useState(false)
    const capsId = useId()
    const detectCaps = (event: KeyboardEvent<HTMLInputElement>): void => {
      if (typeof event.getModifierState === 'function')
        setCapsLock(event.getModifierState('CapsLock'))
    }
    return (
      <div>
        <div className="relative">
          <input
            ref={ref}
            type={visible ? 'text' : 'password'}
            autoComplete="current-password"
            spellCheck={false}
            autoCapitalize="none"
            className={cx(controlClasses, 'pr-11', className)}
            aria-describedby={
              [describedBy, capsLock ? capsId : undefined].filter(Boolean).join(' ') || undefined
            }
            onKeyDown={(event) => {
              detectCaps(event)
              onKeyDown?.(event)
            }}
            onKeyUp={(event) => {
              detectCaps(event)
              onKeyUp?.(event)
            }}
            data-autofocus={rest.autoFocus ? '' : undefined}
            {...rest}
          />
          <button
            type="button"
            // Keep focus in the field; the toggle is a convenience, not a tab stop.
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setVisible((value) => !value)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            className="absolute top-1/2 right-1 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded text-fg-muted hover:bg-surface-muted"
          >
            {visible ? (
              <EyeOff aria-hidden className="size-4" />
            ) : (
              <Eye aria-hidden className="size-4" />
            )}
          </button>
        </div>
        {capsLock && (
          <p id={capsId} role="status" className="mt-1 text-sm font-medium text-warning-fg">
            Caps Lock is on
          </p>
        )}
      </div>
    )
  }
)
