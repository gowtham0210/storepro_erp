import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import { AppError } from '@shared/ipc/errors'
import { ADMIN, fakeBackend, STORE, userWithRole } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

async function axeViolations(): Promise<string[]> {
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag22aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false } }
  })
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )
}

const TN_GSTIN = '33AAPFU0939F1Z2'

const stepHeading = (name: string) => screen.findByRole('heading', { level: 2, name })
async function answerGst(answer: 'Yes' | 'No'): Promise<void> {
  const question = await screen.findByRole('group', { name: 'Is the store registered for GST?' })
  await userEvent.click(within(question).getByRole('radio', { name: new RegExp(`^${answer}`) }))
}

const next = () => userEvent.click(screen.getByRole('button', { name: 'Continue' }))

async function fillStoreDetails(): Promise<void> {
  await userEvent.type(await screen.findByLabelText(/^Store name/), 'Lakshmi Stores')
  await userEvent.type(screen.getByLabelText(/^Phone number/), '044 2345 6789')
  await userEvent.type(screen.getByLabelText(/^Street address/), '4 Bazaar Street')
  await userEvent.type(screen.getByLabelText(/^City or town/), 'Chennai')
  await userEvent.selectOptions(screen.getByLabelText(/^State/), 'TN')
  await userEvent.type(screen.getByLabelText(/^PIN code/), '600001')
}

// Long, multi-step flows: give them room under coverage instrumentation.
describe('first-run setup wizard (M03-02)', { timeout: 30_000 }, () => {
  it('walks through the store, tax, receipts and account, then finishes in one go', async () => {
    fakeBackend.authState = { status: 'setup-required' }
    fakeBackend.on('setup:complete', ({ administrator }) => {
      fakeBackend.authState = {
        status: 'signed-in',
        user: { ...ADMIN, username: administrator.username, displayName: administrator.displayName }
      }
      return fakeBackend.authState.user
    })
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up StorePro' })).toBeTruthy()
    const steps = screen.getByRole('list', { name: 'Setup steps' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(6)
    expect(await stepHeading('Store details')).toBeTruthy()
    expect(await axeViolations()).toEqual([])

    // Nothing filled in: every required field says what it needs, and focus goes to the first.
    await next()
    expect(screen.getByText('Enter the store name')).toBeTruthy()
    expect(screen.getByText('Choose the state', { selector: 'span' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Store name/))
    await fillStoreDetails()
    await next()

    expect(await stepHeading('Business and region')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 }))
    expect(screen.getByRole('radio', { name: /Grocery/ })).toHaveProperty('checked', true)
    expect(screen.getByRole('radio', { name: /Restaurant/ })).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(/^Currency/)).toHaveProperty('value', 'INR')
    await next()

    expect(await stepHeading('Tax')).toBeTruthy()
    await next()
    expect(screen.getByText('Choose yes or no')).toBeTruthy()
    await answerGst('Yes')
    // A Maharashtra GSTIN for a Tamil Nadu store.
    await userEvent.type(screen.getByLabelText(/^GSTIN/), '27AAPFU0939F1ZV')
    await next()
    expect(screen.getByText('A GSTIN registered in Tamil Nadu starts with 33')).toBeTruthy()
    await userEvent.clear(screen.getByLabelText(/^GSTIN/))
    await userEvent.type(screen.getByLabelText(/^GSTIN/), TN_GSTIN.toLowerCase())
    await next()

    expect(await stepHeading('Receipts')).toBeTruthy()
    const prefix = screen.getByLabelText(/^Invoice number prefix/)
    await userEvent.clear(prefix)
    await userEvent.type(prefix, 'ls')
    await userEvent.type(screen.getByLabelText(/Message at the bottom/), 'Thank you! Visit again.')
    const preview = screen.getByRole('figure', { name: 'Receipt preview' })
    expect(within(preview).getByText('Lakshmi Stores')).toBeTruthy()
    expect(within(preview).getByText('Bill: LS000001')).toBeTruthy()
    expect(within(preview).getByText('Thank you! Visit again.')).toBeTruthy()
    await next()

    expect(await stepHeading('Your account')).toBeTruthy()
    await userEvent.type(screen.getByLabelText(/^Your name/), 'Lakshmi Narayanan')
    await userEvent.type(screen.getByLabelText(/^Username/), 'lakshmi')
    await userEvent.type(screen.getByLabelText(/^Password/), 'counter-top-42')
    await userEvent.type(screen.getByLabelText(/^Confirm password/), 'counter-top-42')
    await next()

    expect(await stepHeading('Check and finish')).toBeTruthy()
    const store = screen.getByRole('region', { name: 'Store details' })
    expect(
      within(store).getByText('4 Bazaar Street, Chennai, Tamil Nadu, 600001, India')
    ).toBeTruthy()
    expect(
      within(screen.getByRole('region', { name: 'Tax' })).getByText(`Registered: ${TN_GSTIN}`)
    ).toBeTruthy()
    expect(await axeViolations()).toEqual([])

    // Going back to change something keeps everything else.
    await userEvent.click(screen.getByRole('button', { name: 'Change store details' }))
    expect(screen.getByLabelText(/^Store name/)).toHaveProperty('value', 'Lakshmi Stores')
    for (let i = 0; i < 5; i++) await next()
    await stepHeading('Check and finish')

    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeTruthy()
    expect(fakeBackend.callsTo('setup:complete')).toEqual([
      {
        store: {
          name: 'Lakshmi Stores',
          addressLine1: '4 Bazaar Street',
          addressLine2: null,
          city: 'Chennai',
          countryCode: 'IN',
          regionCode: 'TN',
          postalCode: '600001',
          phone: '044 2345 6789',
          email: null,
          currencyCode: 'INR',
          timeZone: expect.any(String),
          businessTypeCode: 'grocery',
          taxRegistrationNumber: TN_GSTIN,
          pricesIncludeTax: true,
          invoicePrefix: 'LS',
          receiptHeader: null,
          receiptFooter: 'Thank you! Visit again.',
          allowNegativeStock: false
        },
        administrator: {
          displayName: 'Lakshmi Narayanan',
          username: 'lakshmi',
          password: 'counter-top-42'
        }
      }
    ])
  })

  it('fits the questions to another country', async () => {
    fakeBackend.authState = { status: 'setup-required' }
    renderApp('/')
    await userEvent.selectOptions(await screen.findByLabelText(/^Country/), 'AE')
    // No Indian states or PIN codes outside India.
    expect(screen.getByLabelText(/^State or region/).tagName).toBe('INPUT')
    expect(screen.getByLabelText(/^Postal code/)).toBeTruthy()
    await userEvent.type(screen.getByLabelText(/^Store name/), 'Al Noor Grocery')
    await userEvent.type(screen.getByLabelText(/^Phone number/), '+971 4 123 4567')
    await userEvent.type(screen.getByLabelText(/^Street address/), 'Al Rigga Road')
    await userEvent.type(screen.getByLabelText(/^City or town/), 'Dubai')
    await next()
    // Choosing the country picked its currency and time zone.
    await stepHeading('Business and region')
    expect(screen.getByLabelText(/^Currency/)).toHaveProperty('value', 'AED')
    expect(screen.getByLabelText(/^Time zone/)).toHaveProperty('value', 'Asia/Dubai')
    await next()
    expect(
      await screen.findByRole('group', { name: 'Is the store registered for tax?' })
    ).toBeTruthy()
  })

  it('takes you to the step with a problem the main process found', async () => {
    fakeBackend.authState = { status: 'setup-required' }
    fakeBackend.on('setup:complete', () => {
      throw new AppError('VALIDATION_FAILED', 'invalid', [
        { path: 'store.currencyCode', message: 'Choose a currency' }
      ])
    })
    renderApp('/')
    await stepHeading('Store details')
    await fillStoreDetails()
    await next()
    await next()
    await answerGst('No')
    await next()
    await next()
    await userEvent.type(await screen.findByLabelText(/^Your name/), 'Lakshmi')
    await userEvent.type(screen.getByLabelText(/^Username/), 'lakshmi')
    await userEvent.type(screen.getByLabelText(/^Password/), 'counter-top-42')
    await userEvent.type(screen.getByLabelText(/^Confirm password/), 'counter-top-42')
    await next()
    await userEvent.click(await screen.findByRole('button', { name: 'Finish setup' }))
    expect(await stepHeading('Business and region')).toBeTruthy()
    expect(screen.getByText('Choose a currency')).toBeTruthy()
  })

  it('finishes an older store that has an administrator but no store details', async () => {
    let profile: typeof STORE | null = null
    fakeBackend.on('store:get-profile', () => profile)
    fakeBackend.on('setup:complete-store', (input) => {
      profile = { ...STORE, ...input }
      return profile
    })
    renderApp('/')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Finish setting up your store' })
    ).toBeTruthy()
    expect(
      within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem')
    ).toHaveLength(5)
    await fillStoreDetails()
    await next()
    await next()
    await answerGst('No')
    await next()
    await next()
    await userEvent.click(await screen.findByRole('button', { name: 'Finish setup' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeTruthy()
    expect(fakeBackend.callsTo('setup:complete-store')).toHaveLength(1)
  })

  it("says so if the store can't be loaded, and can try again", async () => {
    let attempts = 0
    fakeBackend.on('store:get-profile', () => {
      attempts++
      if (attempts === 1) throw new AppError('INTERNAL', 'An unexpected error occurred.')
      return STORE
    })
    renderApp('/billing')
    expect(
      await screen.findByRole('heading', { level: 1, name: "StorePro couldn't open the store" })
    ).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeTruthy()
  })

  it('keeps everyone else out until an administrator finishes setup (FR-005)', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('cashier') }
    fakeBackend.on('store:get-profile', () => null)
    renderApp('/billing')
    expect(
      await screen.findByRole('heading', { level: 1, name: "StorePro isn't set up yet" })
    ).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(fakeBackend.callsTo('auth:sign-out')).toHaveLength(1))
  })
})

describe('settings (M03-04)', () => {
  it('saves one section at a time, sending the whole profile', async () => {
    fakeBackend.on('store:update', (input) => ({ ...STORE, ...input }))
    renderApp('/settings')
    await screen.findByRole('heading', { level: 1, name: 'Settings' })
    const receipts = screen.getByRole('region', { name: 'Receipts' })
    const save = within(receipts).getByRole('button', { name: 'Save receipts' })
    expect(save).toHaveProperty('disabled', true)

    const footer = within(receipts).getByLabelText(/Message at the bottom/)
    await userEvent.clear(footer)
    await userEvent.type(footer, 'Exchange in 7 days.')
    expect(within(receipts).getByText('Unsaved changes')).toBeTruthy()
    await userEvent.click(save)
    expect(await screen.findByText('Receipts saved.')).toBeTruthy()
    expect(fakeBackend.callsTo('store:update')).toEqual([
      { ...storeInput(), receiptFooter: 'Exchange in 7 days.' }
    ])
    expect(await axeViolations()).toEqual([])
  }, 20_000)

  it('shows a field error from the main process on its field', async () => {
    fakeBackend.on('store:update', () => {
      throw new AppError('VALIDATION_FAILED', 'invalid', [
        { path: 'currencyCode', message: "The currency can't change after the first sale" }
      ])
    })
    renderApp('/settings')
    const region = await screen.findByRole('region', { name: 'Business and region' })
    await userEvent.selectOptions(await within(region).findByLabelText(/^Currency/), 'USD')
    await userEvent.click(within(region).getByRole('button', { name: 'Save business and region' }))
    expect(
      await within(region).findByText("The currency can't change after the first sale")
    ).toBeTruthy()
  })

  it('is read-only for managers', async () => {
    fakeBackend.authState = { status: 'signed-in', user: userWithRole('manager') }
    renderApp('/settings')
    expect(await screen.findByText(/only an administrator can change them/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull()
    // Disabled through its fieldset.
    expect(screen.getByLabelText(/^Store name/).matches(':disabled')).toBe(true)
    expect(screen.getByLabelText(/^Store name/)).toHaveProperty('value', STORE.name)
  })
})

function storeInput() {
  const { currency: _c, businessTypeName: _b, setUpAt: _s, updatedAt: _u, ...input } = STORE
  return input
}
