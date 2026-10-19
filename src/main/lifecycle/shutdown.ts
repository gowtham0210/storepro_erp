import type { Logger } from '../logging/logger'

export type ShutdownHook = () => void | Promise<void>

export interface ShutdownCoordinatorOptions {
  logger: Logger
  /** Maximum time a single hook may take before shutdown moves on. */
  hookTimeoutMs?: number
}

/**
 * Runs cleanup hooks once, in reverse registration order (resources opened
 * last are closed first). A failing or hanging hook is logged and skipped so
 * it cannot block the remaining hooks or the exit.
 */
export class ShutdownCoordinator {
  private readonly hooks: { name: string; run: ShutdownHook }[] = []
  private readonly logger: Logger
  private readonly hookTimeoutMs: number
  private running: Promise<void> | null = null

  constructor({ logger, hookTimeoutMs = 5000 }: ShutdownCoordinatorOptions) {
    this.logger = logger
    this.hookTimeoutMs = hookTimeoutMs
  }

  register(name: string, run: ShutdownHook): void {
    if (this.running) throw new Error(`Cannot register shutdown hook "${name}" during shutdown`)
    this.hooks.push({ name, run })
  }

  get isShuttingDown(): boolean {
    return this.running !== null
  }

  run(reason: string): Promise<void> {
    this.running ??= this.runHooks(reason)
    return this.running
  }

  private async runHooks(reason: string): Promise<void> {
    this.logger.info('Shutting down', { reason })
    for (const hook of [...this.hooks].reverse()) {
      const started = Date.now()
      try {
        await withTimeout(Promise.resolve().then(hook.run), this.hookTimeoutMs)
        this.logger.debug('Shutdown hook finished', { hook: hook.name, ms: Date.now() - started })
      } catch (error) {
        this.logger.error('Shutdown hook failed', { hook: hook.name, error })
      }
    }
    this.logger.info('Shutdown complete')
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
