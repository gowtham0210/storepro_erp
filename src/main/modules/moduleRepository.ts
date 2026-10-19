import type { ModuleCode } from '@shared/modules'
import { Repository } from '../db/repository'

/** Which modules are switched on (`enabled_modules`), M04-02. */
export class ModuleRepository extends Repository {
  enabled(): Map<ModuleCode, number> {
    return new Map(
      this.db
        .all<{ module_code: ModuleCode; enabled_at: number }>(
          'SELECT module_code, enabled_at FROM enabled_modules'
        )
        .map((row) => [row.module_code, row.enabled_at])
    )
  }

  enable(code: ModuleCode): void {
    this.db.run('INSERT OR IGNORE INTO enabled_modules (module_code, enabled_at) VALUES (?, ?)', [
      code,
      this.now()
    ])
  }

  /** Only forgets that it is on: the module's data stays (PRD §7.3). */
  disable(code: ModuleCode): void {
    this.db.run('DELETE FROM enabled_modules WHERE module_code = ?', [code])
  }

  businessTypeCode(): string | null {
    return (
      this.db.get<{ business_type_code: string }>(
        'SELECT business_type_code FROM businesses WHERE business_id = 1'
      )?.business_type_code ?? null
    )
  }
}
