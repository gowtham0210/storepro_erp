/**
 * Password rules (NIST SP 800-63B): length matters, composition rules don't.
 * At least 8 characters, at most 128, not a commonly used password and not
 * the username. Any characters are allowed, including spaces, so passphrases work.
 */

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

/** Passwords that appear at the top of breach lists, plus obvious shop-specific ones. */
const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  '11111111',
  '00000000',
  '12341234',
  '11223344',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  'qwerty123',
  'qwertyuiop',
  'qwerty12',
  'iloveyou',
  'abcd1234',
  'abc12345',
  'abcdefgh',
  'welcome1',
  'welcome123',
  'letmein1',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'dragon123',
  'master123',
  'monkey123',
  'superman',
  'trustno1',
  'admin123',
  'admin1234',
  'administrator',
  'changeme',
  'default1',
  'test1234',
  'india123',
  'india@123',
  'storepro',
  'storepro1',
  'storepro123',
  'cashier1',
  'cashier123',
  'manager1',
  'manager123',
  'shop1234',
  'store123',
  'grocery1',
  'billing1',
  'billing123'
])

/** The problem with a proposed password, in words for the user, or null if it is acceptable. */
export function passwordProblem(password: string, username = ''): string | null {
  const length = [...password].length
  if (length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters`
  if (length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters`
  const normalised = password.toLowerCase()
  if (COMMON_PASSWORDS.has(normalised))
    return 'This password is too common. Choose something harder to guess'
  if (/^(.)\1+$/.test(password)) return 'Avoid repeating one character'
  if (username && normalised.includes(username.trim().toLowerCase())) {
    return "Don't include your username in the password"
  }
  return null
}
