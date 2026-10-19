import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions
} from 'node:crypto'

/**
 * Password hashing with scrypt (memory-hard; built into Node, so no native
 * module to rebuild for Electron). OWASP's recommended minimum is
 * N = 2^17, r = 8, p = 1, which needs 128 MiB per hash and takes a few
 * hundred milliseconds: fine for a sign-in, ruinous for an attacker
 * guessing offline.
 *
 * Stored format (PHC string style): $scrypt$ln=17,r=8,p=1$<salt>$<hash>
 * The parameters travel with each hash, so they can be raised later and old
 * hashes upgraded at the next successful sign-in (see needsRehash).
 */

export interface ScryptParams {
  /** log2 of the CPU/memory cost N. */
  ln: number
  r: number
  p: number
}

export const DEFAULT_PARAMS: ScryptParams = { ln: 17, r: 8, p: 1 }
const KEY_LENGTH = 32
const SALT_LENGTH = 16

function scrypt(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = {
    N: 2 ** params.ln,
    r: params.r,
    p: params.p,
    // Node's default limit (32 MiB) is below what N = 2^17 needs.
    maxmem: 256 * 1024 * 1024
  }
  return new Promise((resolve, reject) => {
    // Async: runs on the libuv thread pool, so the main process stays responsive.
    scryptCallback(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key)
    )
  })
}

export class PasswordHasher {
  constructor(private readonly params: ScryptParams = DEFAULT_PARAMS) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH)
    const key = await scrypt(password, salt, this.params)
    const { ln, r, p } = this.params
    return `$scrypt$ln=${ln},r=${r},p=${p}$${salt.toString('base64')}$${key.toString('base64')}`
  }

  /** Constant-time comparison. A malformed stored hash never verifies. */
  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parseHash(stored)
    if (!parsed) return false
    const key = await scrypt(password, parsed.salt, parsed.params)
    return key.length === parsed.key.length && timingSafeEqual(key, parsed.key)
  }

  /** True when a stored hash uses weaker parameters than the current ones. */
  needsRehash(stored: string): boolean {
    const parsed = parseHash(stored)
    if (!parsed) return true
    const { ln, r, p } = parsed.params
    return ln < this.params.ln || r < this.params.r || p < this.params.p
  }
}

function parseHash(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const match =
    /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(
      stored
    )
  if (!match) return null
  const [, ln, r, p, salt, key] = match
  const params = { ln: Number(ln), r: Number(r), p: Number(p) }
  // Refuse absurd parameters from a tampered database row (memory exhaustion).
  if (
    params.ln < 10 ||
    params.ln > 20 ||
    params.r < 1 ||
    params.r > 16 ||
    params.p < 1 ||
    params.p > 4
  )
    return null
  return { params, salt: Buffer.from(salt ?? '', 'base64'), key: Buffer.from(key ?? '', 'base64') }
}
