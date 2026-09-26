// docs/09 scenario 17 (UI part) and stop condition 5: an analyst adds a contact, logs a touchpoint and sets a next
// action for an opportunity. The relationship panel shows each of them. The contact data is invented test data.
// The opportunity is the fuel supply opportunity at the Lumwana mine (web page of the fixture brief).
import { expect, test } from "@playwright/test";
import { apiGet, approvedDeal, login, moduleReady, toast } from "../support/stack";

test("scenario 17: an analyst adds a contact, logs a touchpoint and sets a next action, and the relationship panel shows them", async ({ page }) => {
  const deal = await approvedDeal("news/lumwana-expansion.html", "Lumwana", "Fuel supply contract:");
  const run = new Date().toISOString().slice(11, 19);
  const note = `Site visit with the mining contractor at Lumwana (${run})`;
  const action = `Send the fuel supply proposal (${run})`;
  await login(page, "analyst", "relationships");
  const rel = await moduleReady(page, "relationship-panel");
  await rel.getByLabel("Opportunity").selectOption(deal.id);
  await expect(rel).toHaveAttribute("data-module-state", /ready|empty/);

  // Add contact.
  await rel.getByRole("tab", { name: /Contacts/ }).click();
  await rel.getByRole("button", { name: "Add contact" }).click();
  const dlg = page.getByRole("dialog", { name: "Add contact" });
  await dlg.getByLabel("Name").fill(`Bwalya Test-Contact ${run}`);
  await dlg.getByLabel("Role").fill("Fleet manager");
  await dlg.getByLabel("Found via").fill("Referral from the site office");
  await dlg.getByRole("button", { name: "Add contact" }).click();
  await expect(toast(page, "Contact added")).toBeVisible();
  await expect(rel.getByRole("table", { name: "Contacts" })).toContainText(`Bwalya Test-Contact ${run}`);

  // Log touchpoint.
  await rel.getByRole("tab", { name: /Touchpoints/ }).click();
  await rel.getByRole("button", { name: "Log touchpoint" }).click();
  const tp = page.getByRole("dialog", { name: "Log touchpoint" });
  await tp.getByLabel("Kind").selectOption("site_visit");
  await tp.getByLabel("Note").fill(note);
  await tp.getByRole("button", { name: "Log touchpoint" }).click();
  await expect(toast(page, "Touchpoint logged")).toBeVisible();
  await expect(rel.getByRole("table", { name: "Touchpoints" })).toContainText(note);

  // Set next action.
  await rel.getByRole("tab", { name: "Next action" }).click();
  await rel.getByRole("button", { name: "Set next action" }).click();
  const na = page.getByRole("dialog", { name: "Set next action" });
  await na.getByLabel("Action").fill(action);
  await na.getByLabel("Due date").fill("2026-10-15");
  await na.getByRole("button", { name: "Set next action" }).click();
  await expect(toast(page, "Next action set")).toBeVisible();
  await expect(rel.locator("[data-next-action]")).toContainText(action);

  // The API has the same data (each write is an event with actor type human).
  const panel = await apiGet<{ touchpoints: Array<{ data: { note: string } }>; next_action: { data: { action: string } } | null; contacts: unknown[] }>(`/api/deals/${deal.id}/relationship`);
  expect(panel.touchpoints.map((t) => t.data.note)).toContain(note);
  expect(panel.next_action?.data.action).toBe(action);
  expect(panel.contacts.length).toBeGreaterThan(0);
  // The next actions panel shows the next action too (live update).
  const next = await moduleReady(page, "next-actions");
  await expect(next.locator(`[data-row-id="${deal.id}"]`)).toContainText(action);
});
