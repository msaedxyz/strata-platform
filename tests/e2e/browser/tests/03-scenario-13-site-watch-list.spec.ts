// docs/09 scenario 13 (UI part): the site watch list shows the pending status of a site on the daily watch list.
// The Python suite checks the SiteStatusChanged proposal and the Tier 0 alert. The fixture item suspends the
// Mufulira mine of Mopani (mining wire).
import { expect, test } from "@playwright/test";
import { apiGet, login, moduleReady, signalByUrl, waitFor } from "../support/stack";

interface Site { id: string; name: string; status: string | null; status_pending: string | null }

test("scenario 13: the site watch list shows the pending suspension of the Mufulira mine in the unverified style", async ({ page }) => {
  await signalByUrl("mufulira-suspended", "Mufulira");
  const site = await waitFor("the pending status of the Mufulira mine", async () =>
    (await apiGet<{ items: Site[] }>("/api/sites?watch=daily")).items.find((s) => s.name === "Mopani Mufulira mine" && s.status_pending === "suspended"));
  await login(page, "viewer", "monitoring");
  const m = await moduleReady(page, "site-watch-list");
  await m.getByRole("tab", { name: /Daily/ }).click();
  const row = m.locator(`[data-row-id="${site.id}"]`);
  await expect(row).toBeVisible();
  const pending = row.locator('[data-status="pending"]');
  await expect(pending).toHaveText("Suspended, pending");
  // docs/07 rule 4: the pending status has the same style as unconfirmed and reported items.
  expect(await pending.getAttribute("class")).toContain("sds-badge--unverified");
});
