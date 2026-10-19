import { readFileSync, rmSync } from 'node:fs'
import { z } from 'zod'
import type { StartupStatus } from '@shared/ipc/contract'
import { writeFileAtomicSync } from '../lib/atomicWrite'

const markerSchema = z.object({ startedAt: z.string(), pid: z.number(), version: z.string() })

/**
 * Detects unclean shutdowns. A marker file is written at startup and removed
 * on clean exit; finding one at the next startup means the previous session
 * crashed, was killed, or lost power.
 */
export class SessionMarker {
  constructor(private readonly filePath: string) {}

  /** Inspect the previous session's marker, then write one for this session. */
  begin(version: string, now: Date = new Date()): StartupStatus {
    const status = this.readPrevious()
    writeFileAtomicSync(
      this.filePath,
      JSON.stringify({ startedAt: now.toISOString(), pid: process.pid, version })
    )
    return status
  }

  /** Call as the very last step of a clean shutdown. */
  end(): void {
    rmSync(this.filePath, { force: true })
  }

  private readPrevious(): StartupStatus {
    let raw: string
    try {
      raw = readFileSync(this.filePath, 'utf8')
    } catch {
      return { recoveredFromUncleanShutdown: false, previousSessionStartedAt: null }
    }
    let startedAt: string | null = null
    try {
      startedAt = markerSchema.parse(JSON.parse(raw)).startedAt
    } catch {
      // A corrupt marker still means the previous session did not finish cleanly.
    }
    return { recoveredFromUncleanShutdown: true, previousSessionStartedAt: startedAt }
  }
}

const historySchema = z.array(z.number())

/**
 * Persistent record of recent main-process crashes, used to stop automatic
 * relaunching when the app keeps crashing on startup.
 */
export class CrashHistory {
  constructor(
    private readonly filePath: string,
    private readonly windowMs = 10 * 60 * 1000,
    private readonly maxCrashesInWindow = 3
  ) {}

  /** Record a crash and report whether an automatic relaunch is still allowed. */
  recordCrash(now: number = Date.now()): { shouldRelaunch: boolean; recentCrashes: number } {
    const recent = [...this.read().filter((time) => now - time < this.windowMs), now]
    try {
      writeFileAtomicSync(this.filePath, JSON.stringify(recent))
    } catch {
      // Best effort: we are already handling a crash.
    }
    return {
      shouldRelaunch: recent.length <= this.maxCrashesInWindow,
      recentCrashes: recent.length
    }
  }

  private read(): number[] {
    try {
      return historySchema.parse(JSON.parse(readFileSync(this.filePath, 'utf8')))
    } catch {
      return []
    }
  }
}

/**
 * Decides how to react to renderer crashes: reload the window a few times,
 * then give up so a crash loop does not spin forever.
 */
export class RendererCrashGuard {
  private crashes: number[] = []

  constructor(
    private readonly windowMs = 60 * 1000,
    private readonly maxReloadsInWindow = 3
  ) {}

  onCrash(now: number = Date.now()): 'reload' | 'give-up' {
    this.crashes = [...this.crashes.filter((time) => now - time < this.windowMs), now]
    return this.crashes.length <= this.maxReloadsInWindow ? 'reload' : 'give-up'
  }
}
