import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Write a file so that readers see either the old or the new content, never a
 * partially written file (e.g. after a power cut mid-write).
 */
export function writeFileAtomicSync(filePath: string, data: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.tmp`
  writeFileSync(tmpPath, data, { encoding: 'utf8' })
  renameSync(tmpPath, filePath)
}
