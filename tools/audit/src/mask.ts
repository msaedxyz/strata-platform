import type { Locator, Page } from '@playwright/test';

/**
 * Locators to mask in each screenshot: password and e-mail fields, the logged-in user name,
 * and any text that looks like an e-mail address. A mask is a solid box in the image.
 */
export function screenshotMasks(page: Page, username: string): Locator[] {
  const masks = [
    page.locator('input[type="password"], input[type="email"], input[autocomplete="username"], input[autocomplete="email"]'),
    page.getByText(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/),
  ];
  if (username && username.length >= 3) masks.push(page.getByText(username, { exact: false }));
  return masks;
}
