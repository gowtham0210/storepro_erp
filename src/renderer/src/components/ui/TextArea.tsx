import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import { controlClasses } from './Field'

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

/** Multi-line text, such as a receipt footer. Use inside <Field>. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, rows = 3, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cx(controlClasses, 'h-auto min-h-20 resize-y py-2 leading-normal', className)}
      {...rest}
    />
  )
})
