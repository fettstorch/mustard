import { expect, test } from './extension.fixture'

test.describe('Popup login tabs', () => {
  test('renders with Bluesky tab active by default', async ({ context, popupUrl }) => {
    const page = await context.newPage()
    await page.goto(popupUrl)

    const blueskyTab = page.getByRole('tab', { name: 'Bluesky' })
    const githubTab = page.getByRole('tab', { name: 'GitHub' })

    await expect(blueskyTab).toBeVisible()
    await expect(githubTab).toBeVisible()
    await expect(blueskyTab).toHaveAttribute('aria-selected', 'true')
    await expect(githubTab).toHaveAttribute('aria-selected', 'false')
  })

  test('switches to GitHub tab on click', async ({ context, popupUrl }) => {
    const page = await context.newPage()
    await page.goto(popupUrl)

    const githubTab = page.getByRole('tab', { name: 'GitHub' })
    await githubTab.click()

    await expect(githubTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Bluesky' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })
})
