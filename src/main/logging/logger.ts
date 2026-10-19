import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LogLevel } from '@shared/ipc/contract'
import { redact } from './redact'

export type { LogLevel }

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
  child(scope: string): Logger
}

export interface FileLoggerOptions {
  dir: string
  fileName?: string
  /** Rotate once the active file would exceed this size. */
  maxBytes?: number
  /** Total number of files kept, including the active one. */
  maxFiles?: number
  minLevel?: LogLevel
  /** Also mirror entries to stdout/stderr (useful in development). */
  mirrorToConsole?: boolean
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/**
 * Size-rotated log file: `main.log` is active, `main.1.log` is the most recent
 * rotated file, up to `main.{maxFiles - 1}.log`.
 *
 * Writes are synchronous so the last entries before a crash reach the disk.
 */
class RotatingFile {
  private readonly activePath: string
  private size: number

  constructor(
    private readonly dir: string,
    private readonly fileName: string,
    private readonly maxBytes: number,
    private readonly maxFiles: number
  ) {
    mkdirSync(dir, { recursive: true })
    this.activePath = join(dir, fileName)
    this.size = existsSync(this.activePath) ? statSync(this.activePath).size : 0
  }

  write(line: string): void {
    const bytes = Buffer.byteLength(line)
    if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate()
    appendFileSync(this.activePath, line, { encoding: 'utf8' })
    this.size += bytes
  }

  private rotatedPath(index: number): string {
    const dot = this.fileName.lastIndexOf('.')
    const base = dot > 0 ? this.fileName.slice(0, dot) : this.fileName
    const ext = dot > 0 ? this.fileName.slice(dot) : ''
    return join(this.dir, `${base}.${index}${ext}`)
  }

  private rotate(): void {
    const oldest = this.maxFiles - 1
    if (oldest < 1) {
      rmSync(this.activePath, { force: true })
    } else {
      rmSync(this.rotatedPath(oldest), { force: true })
      for (let i = oldest - 1; i >= 1; i--) {
        const from = this.rotatedPath(i)
        if (existsSync(from)) renameSync(from, this.rotatedPath(i + 1))
      }
      renameSync(this.activePath, this.rotatedPath(1))
    }
    this.size = 0
  }
}

interface LogSink {
  minLevel: number
  mirrorToConsole: boolean
  file: RotatingFile
}

class ScopedLogger implements Logger {
  constructor(
    private readonly sink: LogSink,
    private readonly scope: string
  ) {}

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context)
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context)
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context)
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context)
  }

  child(scope: string): Logger {
    return new ScopedLogger(this.sink, `${this.scope}:${scope}`)
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.sink.minLevel) return
    const line = formatLine(level, this.scope, message, context)
    if (this.sink.mirrorToConsole) {
      ;(level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line)
    }
    try {
      this.sink.file.write(line)
    } catch (error) {
      // Logging must never take the application down.
      process.stderr.write(`[logger] failed to write log file: ${String(error)}\n${line}`)
    }
  }
}

export function formatLine(
  level: LogLevel,
  scope: string,
  message: string,
  context?: Record<string, unknown>
): string {
  const head = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${message}`
  if (context === undefined || Object.keys(context).length === 0) return `${head}\n`
  let serialised: string
  try {
    serialised = JSON.stringify(redact(context))
  } catch {
    serialised = '"[unserialisable context]"'
  }
  return `${head} ${serialised}\n`
}

export function createFileLogger(options: FileLoggerOptions, scope = 'main'): Logger {
  if (options.mirrorToConsole) {
    // A closed terminal makes console writes fail with EPIPE; that must not
    // surface as an uncaught exception. The log file still gets every entry.
    for (const stream of [process.stdout, process.stderr]) {
      if (stream.listenerCount('error') === 0) stream.on('error', () => {})
    }
  }
  const sink: LogSink = {
    minLevel: LEVEL_ORDER[options.minLevel ?? 'info'],
    mirrorToConsole: options.mirrorToConsole ?? false,
    file: new RotatingFile(
      options.dir,
      options.fileName ?? 'main.log',
      options.maxBytes ?? 5 * 1024 * 1024,
      options.maxFiles ?? 5
    )
  }
  return new ScopedLogger(sink, scope)
}
