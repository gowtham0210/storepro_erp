import { app, BrowserWindow, dialog } from 'electron'
import type { BackupDialogAdapter } from './backupService'

export function createElectronBackupAdapter(): BackupDialogAdapter {
  return {
    async pickFolder(defaultPath: string): Promise<string | null> {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options: Electron.OpenDialogOptions = {
        title: 'Choose backup folder',
        defaultPath,
        properties: ['openDirectory', 'createDirectory']
      }
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0] ?? null
    },

    async pickBackupFile(defaultPath: string): Promise<string | null> {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options: Electron.OpenDialogOptions = {
        title: 'Select StorePro backup file (.db)',
        defaultPath,
        filters: [{ name: 'StorePro Database Backup', extensions: ['db', 'sqlite'] }],
        properties: ['openFile']
      }
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0] ?? null
    },

    relaunchApp(): void {
      setImmediate(() => {
        app.relaunch()
        app.quit()
      })
    }
  }
}
