import type { PrinterConfig, WeighBarcodeSettings } from '@shared/ipc/contract'
import { DEFAULT_WEIGH_BARCODE_CONFIG } from '@shared/scanner'
import { printerConfigSchema, weighBarcodeSettingsSchema } from '@shared/schemas/printing'
import { Repository } from '../db/repository'

const PRINTER_CONFIG_KEY = 'printerconfig'
const WEIGH_BARCODE_KEY = 'weighbarcodeconfig'

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  printerName: null,
  paperWidthMm: 80,
  printMode: 'driver',
  autoPrintReceipt: false,
  openCashDrawer: false
}

/**
 * Device-local printer configuration and grocery variable-weight barcode
 * settings stored in `app_settings` (M21-02, M21-03, M24-02).
 */
export class PrinterRepository extends Repository {
  getPrinterConfig(): PrinterConfig {
    const row = this.db.get<{ setting_value: string }>(
      'SELECT setting_value FROM app_settings WHERE setting_key = ?',
      [PRINTER_CONFIG_KEY]
    )
    if (!row) return { ...DEFAULT_PRINTER_CONFIG }
    try {
      const parsed = printerConfigSchema.safeParse(JSON.parse(row.setting_value))
      return parsed.success ? parsed.data : { ...DEFAULT_PRINTER_CONFIG }
    } catch {
      return { ...DEFAULT_PRINTER_CONFIG }
    }
  }

  setPrinterConfig(config: PrinterConfig): PrinterConfig {
    const clean = printerConfigSchema.parse(config)
    const now = this.now()
    this.db.run(
      `INSERT INTO app_settings (setting_key, setting_value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (setting_key) DO UPDATE SET
         setting_value = excluded.setting_value,
         updated_at = excluded.updated_at`,
      [PRINTER_CONFIG_KEY, JSON.stringify(clean), now]
    )
    return clean
  }

  getWeighBarcodeSettings(): WeighBarcodeSettings {
    const row = this.db.get<{ setting_value: string }>(
      'SELECT setting_value FROM app_settings WHERE setting_key = ?',
      [WEIGH_BARCODE_KEY]
    )
    if (!row) return { ...DEFAULT_WEIGH_BARCODE_CONFIG }
    try {
      const parsed = weighBarcodeSettingsSchema.safeParse(JSON.parse(row.setting_value))
      return parsed.success ? parsed.data : { ...DEFAULT_WEIGH_BARCODE_CONFIG }
    } catch {
      return { ...DEFAULT_WEIGH_BARCODE_CONFIG }
    }
  }

  setWeighBarcodeSettings(settings: WeighBarcodeSettings): WeighBarcodeSettings {
    const clean = weighBarcodeSettingsSchema.parse(settings)
    const now = this.now()
    this.db.run(
      `INSERT INTO app_settings (setting_key, setting_value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (setting_key) DO UPDATE SET
         setting_value = excluded.setting_value,
         updated_at = excluded.updated_at`,
      [WEIGH_BARCODE_KEY, JSON.stringify(clean), now]
    )
    return clean
  }
}
