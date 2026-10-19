import { useCallback, useRef, useState, type FormEvent } from 'react'
import type { z } from 'zod'
import { fieldErrorsFrom } from '../lib/describeError'

type FieldValues = Record<string, unknown>

export interface UseFormOptions<S extends z.ZodType<unknown, FieldValues>> {
  /** Usually a schema from src/shared, the same one the main-process handler uses. */
  schema: S
  initialValues: z.input<S>
  onSubmit: (values: z.output<S>) => Promise<void> | void
}

export interface FieldBinding {
  name: string
  value: string
  onChange: (event: { target: { value: string } }) => void
  onBlur: () => void
  ref: (element: HTMLElement | null) => void
}

/**
 * Form state and validation with a Zod schema.
 *
 * Timing follows "reward early, punish late": a field is checked when the user
 * leaves it, rechecked on every change once it shows an error, and everything
 * is checked on submit, which then focuses the first problem. Server-side
 * validation errors (VALIDATION_FAILED) land on the same fields.
 */
export function useForm<S extends z.ZodType<unknown, FieldValues>>({
  schema,
  initialValues,
  onSubmit
}: UseFormOptions<S>) {
  const [values, setValues] = useState<z.input<S>>(initialValues)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const elements = useRef(new Map<string, HTMLElement>())

  const validate = useCallback(
    (candidate: z.input<S>): { data: z.output<S> | null; errors: Record<string, string> } => {
      const result = schema.safeParse(candidate)
      if (result.success) return { data: result.data, errors: {} }
      const found: Record<string, string> = {}
      for (const issue of result.error.issues) {
        const path = issue.path.map(String).join('.')
        if (!(path in found)) found[path] = issue.message
      }
      return { data: null, errors: found }
    },
    [schema]
  )

  const validateField = (name: string, candidate: z.input<S>): void => {
    const message = validate(candidate).errors[name]
    setErrors((current) => {
      if (message) return { ...current, [name]: message }
      const { [name]: _cleared, ...rest } = current
      return rest
    })
  }

  // The latest values, so several changes within one event are not lost.
  const latest = useRef(values)
  const setValue = (name: string, value: unknown): void => {
    const next = { ...latest.current, [name]: value } as z.input<S>
    latest.current = next
    setValues(next)
    if (errors[name]) validateField(name, next)
  }

  /** Focus the invalid field that comes first on screen (document order). */
  const focusFirstError = (found: Record<string, string>): void => {
    const invalid = Object.keys(found)
      .map((name) => elements.current.get(name))
      .filter((element): element is HTMLElement => element !== undefined)
    invalid.sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    )
    invalid[0]?.focus()
  }

  const field = (name: string): FieldBinding => {
    return {
      name,
      value: String((values as FieldValues)[name] ?? ''),
      onChange: (event) => setValue(name, event.target.value),
      onBlur: () => validateField(name, latest.current),
      ref: (element) => {
        if (element) elements.current.set(name, element)
        else elements.current.delete(name)
      }
    }
  }

  const handleSubmit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    if (submitting) return
    const { data, errors: found } = validate(latest.current)
    setErrors(found)
    if (data === null) {
      focusFirstError(found)
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(data)
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Show a handler's validation errors on the fields. Returns false when the
   * error is not a field-level validation error (show it another way).
   */
  const applyServerError = (error: unknown): boolean => {
    const found = fieldErrorsFrom(error)
    if (!found || Object.keys(found).length === 0) return false
    setErrors(found)
    focusFirstError(found)
    return true
  }

  return {
    values,
    errors,
    submitting,
    field,
    setValue,
    handleSubmit,
    applyServerError,
    reset: () => {
      latest.current = initialValues
      setValues(initialValues)
      setErrors({})
    }
  }
}
