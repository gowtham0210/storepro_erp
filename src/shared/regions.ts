/**
 * Countries StorePro is set up for, and India's states and union territories
 * with their GST state codes.
 *
 * A store's region is stored as its ISO 3166-2 subdivision code ("TN" for
 * Tamil Nadu). GST uses its own two-digit codes ("33"), which begin every
 * GSTIN and decide whether a sale is within the state (CGST + SGST) or
 * between states (IGST).
 *
 * Runtime-dependency free: used by both processes.
 */

export interface Country {
  code: string
  name: string
  currencyCode: string
  defaultTimeZone: string
}

/** Countries whose currencies are seeded (migration 0001). The first release targets India. */
export const COUNTRIES: readonly Country[] = [
  { code: 'IN', name: 'India', currencyCode: 'INR', defaultTimeZone: 'Asia/Kolkata' },
  { code: 'AE', name: 'United Arab Emirates', currencyCode: 'AED', defaultTimeZone: 'Asia/Dubai' },
  { code: 'BD', name: 'Bangladesh', currencyCode: 'BDT', defaultTimeZone: 'Asia/Dhaka' },
  { code: 'LK', name: 'Sri Lanka', currencyCode: 'LKR', defaultTimeZone: 'Asia/Colombo' },
  { code: 'NP', name: 'Nepal', currencyCode: 'NPR', defaultTimeZone: 'Asia/Kathmandu' },
  { code: 'US', name: 'United States', currencyCode: 'USD', defaultTimeZone: 'America/New_York' }
]

export interface IndianState {
  /** ISO 3166-2:IN subdivision code, without the "IN-" prefix. */
  code: string
  name: string
  /** Two-digit GST state code. */
  gstCode: string
}

export const INDIAN_STATES: readonly IndianState[] = [
  { code: 'AN', name: 'Andaman and Nicobar Islands', gstCode: '35' },
  { code: 'AP', name: 'Andhra Pradesh', gstCode: '37' },
  { code: 'AR', name: 'Arunachal Pradesh', gstCode: '12' },
  { code: 'AS', name: 'Assam', gstCode: '18' },
  { code: 'BR', name: 'Bihar', gstCode: '10' },
  { code: 'CH', name: 'Chandigarh', gstCode: '04' },
  { code: 'CT', name: 'Chhattisgarh', gstCode: '22' },
  { code: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu', gstCode: '26' },
  { code: 'DL', name: 'Delhi', gstCode: '07' },
  { code: 'GA', name: 'Goa', gstCode: '30' },
  { code: 'GJ', name: 'Gujarat', gstCode: '24' },
  { code: 'HR', name: 'Haryana', gstCode: '06' },
  { code: 'HP', name: 'Himachal Pradesh', gstCode: '02' },
  { code: 'JK', name: 'Jammu and Kashmir', gstCode: '01' },
  { code: 'JH', name: 'Jharkhand', gstCode: '20' },
  { code: 'KA', name: 'Karnataka', gstCode: '29' },
  { code: 'KL', name: 'Kerala', gstCode: '32' },
  { code: 'LA', name: 'Ladakh', gstCode: '38' },
  { code: 'LD', name: 'Lakshadweep', gstCode: '31' },
  { code: 'MP', name: 'Madhya Pradesh', gstCode: '23' },
  { code: 'MH', name: 'Maharashtra', gstCode: '27' },
  { code: 'MN', name: 'Manipur', gstCode: '14' },
  { code: 'ML', name: 'Meghalaya', gstCode: '17' },
  { code: 'MZ', name: 'Mizoram', gstCode: '15' },
  { code: 'NL', name: 'Nagaland', gstCode: '13' },
  { code: 'OR', name: 'Odisha', gstCode: '21' },
  { code: 'PY', name: 'Puducherry', gstCode: '34' },
  { code: 'PB', name: 'Punjab', gstCode: '03' },
  { code: 'RJ', name: 'Rajasthan', gstCode: '08' },
  { code: 'SK', name: 'Sikkim', gstCode: '11' },
  { code: 'TN', name: 'Tamil Nadu', gstCode: '33' },
  { code: 'TG', name: 'Telangana', gstCode: '36' },
  { code: 'TR', name: 'Tripura', gstCode: '16' },
  { code: 'UP', name: 'Uttar Pradesh', gstCode: '09' },
  { code: 'UT', name: 'Uttarakhand', gstCode: '05' },
  { code: 'WB', name: 'West Bengal', gstCode: '19' }
]

export function countryByCode(code: string): Country | undefined {
  return COUNTRIES.find((country) => country.code === code)
}

export function indianStateByCode(code: string): IndianState | undefined {
  return INDIAN_STATES.find((state) => state.code === code)
}

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/**
 * Why a GSTIN isn't valid, or null if it is. Checks the format (15
 * characters: state code, PAN, entity number, "Z", check character), the
 * check character, and that it belongs to the store's state.
 */
export function gstinProblem(gstin: string, stateCode?: string | null): string | null {
  if (gstin.length !== 15) return 'A GSTIN has 15 characters'
  if (!GSTIN_PATTERN.test(gstin)) return 'Check the GSTIN: it looks like 33ABCDE1234F1Z5'
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(gstin.charAt(i)) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  if (GSTIN_CHARS.charAt((36 - (sum % 36)) % 36) !== gstin.charAt(14)) {
    return 'This GSTIN has a typing mistake: its last character does not match'
  }
  if (stateCode) {
    const state = indianStateByCode(stateCode)
    if (state && gstin.slice(0, 2) !== state.gstCode) {
      return `A GSTIN registered in ${state.name} starts with ${state.gstCode}`
    }
  }
  return null
}
