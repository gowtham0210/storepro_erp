import type { StoreProfileInput } from '../ipc/contract'

/** A valid store for tests: a grocery in Mumbai, registered for GST. */
export const TEST_STORE: StoreProfileInput = {
  name: 'Sharma General Stores',
  addressLine1: '12 Station Road',
  addressLine2: null,
  city: 'Mumbai',
  regionCode: 'MH',
  postalCode: '400001',
  countryCode: 'IN',
  phone: '+91 22 2345 6789',
  email: null,
  // The GST portal's published example GSTIN, registered in Maharashtra (27).
  taxRegistrationNumber: '27AAPFU0939F1ZV',
  currencyCode: 'INR',
  timeZone: 'Asia/Kolkata',
  businessTypeCode: 'grocery',
  pricesIncludeTax: true,
  allowNegativeStock: false,
  receiptHeader: null,
  receiptFooter: 'Thank you! Visit again.',
  invoicePrefix: 'INV'
}
