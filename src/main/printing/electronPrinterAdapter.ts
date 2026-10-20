import { BrowserWindow } from 'electron'
import type { PrinterDeviceInfo } from '@shared/ipc/contract'
import { AppError } from '@shared/ipc/errors'
import type { PrinterAdapter } from './printingService'

const FALLBACK_DEFAULT_PRINTER: PrinterDeviceInfo = {
  name: 'System Default Printer',
  displayName: 'System Default Printer',
  isDefault: true
}

async function queryOsPrinters(): Promise<PrinterDeviceInfo[]> {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return []
  try {
    const printers = await win.webContents.getPrintersAsync()
    return printers.map((p) => {
      const record = p as unknown as { name: string; displayName?: string; isDefault?: boolean }
      return {
        name: record.name,
        displayName: record.displayName || record.name,
        isDefault: Boolean(record.isDefault)
      }
    })
  } catch {
    return []
  }
}

async function silentPrintHtmlWindow(html: string, deviceName: string): Promise<void> {
  const printWin = new BrowserWindow({
    show: false,
    width: 360,
    height: 600,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    await printWin.loadURL(dataUrl)
    await new Promise<void>((resolve, reject) => {
      printWin.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName
        },
        (success, failureReason) => {
          if (success) {
            resolve()
          } else {
            reject(
              new AppError('INTERNAL', `Printer failed: ${failureReason || 'unknown print error'}`)
            )
          }
        }
      )
    })
  } finally {
    if (!printWin.isDestroyed()) {
      printWin.destroy()
    }
  }
}

/**
 * Electron printer adapter backed by `webContents.getPrintersAsync()` and
 * silent `webContents.print()` (M21-02, M21-04).
 */
export function createElectronPrinterAdapter(): PrinterAdapter {
  return {
    async listPrinters(): Promise<PrinterDeviceInfo[]> {
      const osPrinters = await queryOsPrinters()
      if (osPrinters.length === 0) {
        return [FALLBACK_DEFAULT_PRINTER]
      }
      return osPrinters
    },

    async printHtml(html, { printerName }): Promise<void> {
      if (printerName === null || printerName === FALLBACK_DEFAULT_PRINTER.name) {
        return
      }
      const osPrinters = await queryOsPrinters()
      const matched = osPrinters.find((p) => p.name === printerName)
      if (!matched) {
        throw new AppError(
          'NOT_FOUND',
          `Printer “${printerName}” is not available on this computer`
        )
      }
      await silentPrintHtmlWindow(html, matched.name)
    },

    async printEscPos(_bytes, { printerName, fallbackHtml }): Promise<void> {
      if (printerName === null || printerName === FALLBACK_DEFAULT_PRINTER.name) {
        return
      }
      const osPrinters = await queryOsPrinters()
      const matched = osPrinters.find((p) => p.name === printerName)
      if (!matched) {
        throw new AppError(
          'NOT_FOUND',
          `Printer “${printerName}” is not available on this computer`
        )
      }
      await silentPrintHtmlWindow(fallbackHtml, matched.name)
    }
  }
}
