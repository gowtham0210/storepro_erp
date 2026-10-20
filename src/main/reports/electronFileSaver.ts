import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { AppError } from '@shared/ipc/errors'
import type { FileSaver } from './fileSaver'

/**
 * Saves with the operating system's save dialog. Nothing is written until the
 * person picks a place, and the app never chooses a path on its own.
 */
export function createElectronFileSaver(): FileSaver {
  return {
    async saveText(suggestedName, content) {
      const window = BrowserWindow.getFocusedWindow()
      const options = {
        title: 'Save report',
        defaultPath: suggestedName,
        filters: [{ name: 'CSV file (opens in Excel)', extensions: ['csv'] }]
      }
      const chosen = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (chosen.canceled || !chosen.filePath) return null
      try {
        await writeFile(chosen.filePath, content, 'utf8')
      } catch {
        throw new AppError(
          'CONFLICT',
          'The file could not be saved. Check that the folder can be written to and that a file with that name is not open in another program.'
        )
      }
      return { fileName: basename(chosen.filePath) }
    }
  }
}
