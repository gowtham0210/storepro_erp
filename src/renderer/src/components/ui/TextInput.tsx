import { forwardRef, type InputHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import { controlClasses } from './Field'

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, type = 'text', ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cx(controlClasses, className)}
      spellCheck={false}
      data-autofocus={rest.autoFocus ? '' : undefined}
      {...rest}
    />
  )
})
