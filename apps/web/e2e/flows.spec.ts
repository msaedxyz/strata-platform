// End to end flows across modules: docs/09 scenario 4 (UI part), scenario 17 (UI part), the "as of" timeline
// and the provenance control (docs/07 rules 1 and 3). The API is the mocked API over the small fixture dataset.
import type { Page } from "@playwright/test";
import { addPanel, emitLive, expect, moduleReady, openWorkspace, test } from "./harness";

const toast = (page: Page, text: string) => page.locator(".sds-toast-region").getByText(text, { exact: true });
const yesterdayUtc = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

test("scenario 4 (UI part): a Kanban drag shows Pending approval; after approval the card moves, the timeline shows the event with evidence, and as of the previous day shows the old stage", async ({ page, mock, api }) => {
  await openWorkspace(page, "relationships");
  const k = await moduleReady(page, "kanban");
  const card = k.locator('[data-card-id="deal-0014"]');
  await expect(k.locator('[data-column-id="qualified"] [data-card-id="deal-0014"]')).toBeVisible();
  await expect(card).not.toContainText("Pending approval");

  await card.dragTo(k.locator('[data-column-id="contact_found"]'));
  await expect(toast(page, "Moved, pending approval")).toBeVisible();
  // docs/07 rule 3: the card shows "Pending approval" and stays in its stage until an approver decides.
  await expect(card).toContainText("Pending approval");
  await expect(card).toContainText("to Contact found");
  await expect(k.locator('[data-column-id="qualified"] [data-card-id="deal-0014"]')).toBeVisible();
  expect(api.writes).toContainEqual({ path: "/api/deals/deal-0014/stage", body: { to_stage: "contact_found" } });

  // Another user, an approver, approves the DealStageChanged proposal. The API commits and sends the live events.
  const proposal = mock.data.proposals.find((p) => p.stream_id === "deal-0014" && p.status === "pending")!;
  expect(proposal.kind).toBe("DealStageChanged");
  mock.role = "approver";
  mock.userId = "approver-2";
  const res = mock.handle("POST", `/api/proposals/${proposal.id}/approve`, new URLSearchParams(), {});
  expect(res.status).toBe(200);
  await emitLive(page, res.live!);
  await expect(k.locator('[data-column-id="contact_found"] [data-card-id="deal-0014"]')).toBeVisible();
  await expect(card).not.toContainText("Pending approval");

  // The timeline of the opportunity shows the event with its evidence.
  await card.click();
  await addPanel(page, "timeline");
  const t = await moduleReady(page, "timeline");
  await expect(t.locator("[data-timeline-state]")).toHaveAttribute("data-timeline-state", "contact_found");
  const event = t.locator('[data-event-type="DealStageChanged"]').first();
  await expect(event).toContainText("Qualified to Contact found");
  await expect(event.getByRole("button", { name: /Show evidence/ })).toBeVisible();

  // The "as of" view for the previous day re-queries with as_of and shows the old stage.
  await t.getByLabel("As of").fill(yesterdayUtc());
  await expect(t.locator("[data-timeline-state]")).toHaveAttribute("data-timeline-state", "qualified");
  await expect(t.locator('[data-event-type="DealStageChanged"]', { hasText: "Qualified to Contact found" })).toHaveCount(0);
  expect(api.calls.filter((c) => c === "GET /api/timeline").length).toBeGreaterThanOrEqual(2);
  await t.getByRole("button", { name: "Show now" }).click();
  await expect(t.locator("[data-timeline-state]")).toHaveAttribute("data-timeline-state", "contact_found");
});

test("the as of control re-queries the timeline with as_of and shows the state at the end of that day", async ({ page }) => {
  const asOfs: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/timeline") asOfs.push(u.searchParams.get("as_of") ?? "");
  });
  await openWorkspace(page, "relationships");
  await addPanel(page, "timeline");
  const t = await moduleReady(page, "timeline");
  // deal-0003 went Signal, Qualified, Contact found, ... in the fixture history. Its DealIdentified event is day 0.
  await t.getByLabel("Opportunity").selectOption("deal-0003");
  const now = await t.locator("[data-timeline-state]").getAttribute("data-timeline-state");
  await t.getByLabel("As of").fill("2026-06-10");
  await expect(t.locator("[data-timeline-state]")).not.toHaveAttribute("data-timeline-state", now ?? "");
  expect(asOfs).toContain("2026-06-10T23:59:59Z");
  await t.getByLabel("As of").fill("2020-01-01");
  await expect(t.getByText("No events up to 01 Jan 2020")).toBeVisible();
});

test("scenario 17 (UI part): an analyst logs a touchpoint and sets a next action; the relationship panel and the next actions show both", async ({ page, api }) => {
  await openWorkspace(page, "relationships");
  const rel = await moduleReady(page, "relationship-panel");
  await rel.getByLabel("Opportunity").selectOption("deal-0001");
  await expect(rel).toHaveAttribute("data-module-state", "ready");
  // Buyer roles of the project, each with its provenance control.
  const buyers = rel.getByRole("table", { name: "Buyer roles" });
  await expect(buyers.locator("tbody tr[data-row-id]").first()).toBeVisible();
  await expect(buyers.getByRole("button", { name: /Show evidence for Owner/ })).toBeVisible();

  // Log touchpoint.
  await rel.getByRole("tab", { name: /Touchpoints/ }).click();
  await rel.getByRole("button", { name: "Log touchpoint" }).click();
  const tp = page.getByRole("dialog", { name: "Log touchpoint" });
  await tp.getByRole("button", { name: "Log touchpoint" }).click();
  await expect(tp.getByText("Give a value")).toBeVisible();
  await tp.getByLabel("Kind").selectOption("site_visit");
  await tp.getByLabel("Note").fill("Site visit with the mining contractor. They buy diesel each month.");
  await tp.getByRole("button", { name: "Log touchpoint" }).click();
  await expect(toast(page, "Touchpoint logged")).toBeVisible();
  await expect(rel.getByRole("table", { name: "Touchpoints" })).toContainText("Site visit with the mining contractor");

  // Set next action.
  await rel.getByRole("tab", { name: "Next action" }).click();
  await rel.getByRole("button", { name: "Set next action" }).click();
  const na = page.getByRole("dialog", { name: "Set next action" });
  await na.getByLabel("Action").fill("Send the prequalification pack");
  await na.getByLabel("Due date").fill("2026-10-15");
  await na.getByRole("button", { name: "Set next action" }).click();
  await expect(toast(page, "Next action set")).toBeVisible();
  await expect(rel.locator("[data-next-action]")).toContainText("Send the prequalification pack");
  await expect(rel.locator("[data-next-action]")).toContainText("15 Oct 2026");

  // The next actions panel gets the change by the live update.
  const next = await moduleReady(page, "next-actions");
  await expect(next.locator('[data-row-id="deal-0001"]')).toContainText("Send the prequalification pack");

  const tpBody = api.writes.find((w) => w.path === "/api/deals/deal-0001/touchpoints")?.body as Record<string, unknown>;
  expect(tpBody).toMatchObject({ kind: "site_visit", note: "Site visit with the mining contractor. They buy diesel each month." });
  expect(api.writes.find((w) => w.path === "/api/deals/deal-0001/next-action")?.body).toEqual({ action: "Send the prequalification pack", owner_user_id: "e2e-analyst", due_date: "2026-10-15" });
});

test("scenario 17 (UI part): the priority list shows No contact found, and Add contact changes it", async ({ page }) => {
  await openWorkspace(page, "origination");
  const pl = await moduleReady(page, "priority-list");
  await expect(pl.locator('[data-row-id="deal-0001"]')).toContainText("No contact found");
  await pl.locator('[data-row-id="deal-0001"]').click();
  await page.getByRole("dialog", { name: "Priority breakdown" }).getByRole("button", { name: "Close" }).click();
  // In-app navigation keeps the selection. The relationship panel shows the selected opportunity.
  await page.locator('[data-nav-id="relationships"]').click();
  const rel = await moduleReady(page, "relationship-panel");
  await expect(rel.getByLabel("Opportunity")).toHaveValue("deal-0001");
  await rel.getByRole("tab", { name: /Contacts/ }).click();
  await rel.getByRole("button", { name: "Add contact" }).click();
  const dlg = page.getByRole("dialog", { name: "Add contact" });
  await dlg.getByLabel("Name").fill("Mutale Zulu");
  await dlg.getByLabel("Role").fill("Procurement manager");
  await dlg.getByLabel("Found via").fill("Referral from the site office");
  await dlg.getByRole("button", { name: "Add contact" }).click();
  await expect(toast(page, "Contact added")).toBeVisible();
  await expect(rel.getByRole("table", { name: "Contacts" })).toContainText("Mutale Zulu");
  await openWorkspace(page, "origination");
  await expect(page.locator('[data-module="priority-list"] [data-row-id="deal-0001"]')).not.toContainText("No contact found");
});

test("provenance (docs/07 rule 1): a fact opens its evidence with the span highlighted and a link to the source", async ({ page, mock }) => {
  await openWorkspace(page, "origination");
  const pl = await moduleReady(page, "priority-list");
  const deal = mock.data.deals.find((d) => d.id === "deal-0001")!;
  const ev = mock.data.evidence[deal.evidence_ids[0]!]!;
  const control = pl.getByRole("button", { name: `Show evidence for ${deal.title} (1 source)` });
  await expect(control).toHaveAttribute("data-evidence-ids", ev.id);
  await control.click();
  const drawer = page.getByRole("dialog", { name: `Evidence: ${deal.title}` });
  const quote = drawer.locator("blockquote.sds-evidence__quote");
  await expect(quote.locator("mark.sds-evidence__span")).toHaveText(ev.quote);
  // The span shows in its context: the text before and after it comes from the source (licence full).
  await expect(quote.locator(".sds-evidence__context").first()).toContainText("LUSAKA.");
  // The span has its own highlight: its background differs from the quote around it.
  const [markBg, quoteBg] = await quote.locator("mark").evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el.parentElement!).backgroundColor]);
  expect(markBg).not.toBe(quoteBg);
  await expect(drawer.getByRole("link", { name: /Open source/ })).toHaveAttribute("href", ev.url);
  await expect(drawer.locator("figcaption.sds-evidence__source")).toContainText(ev.publisher!);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});

test("provenance: a source without licence full shows the quote only, with no text around it", async ({ page, mock }) => {
  const sig = mock.data.signals.find((s) => mock.data.evidence[s.evidence_ids[0]!]!.context === null)!;
  await openWorkspace(page, "monitoring");
  const feed = await moduleReady(page, "signal-feed");
  await feed.getByRole("searchbox", { name: "Search signals" }).fill(sig.title.slice(0, 40));
  const item = feed.locator(`[data-signal-id="${sig.id}"]`);
  await item.getByRole("button", { name: /Show evidence/ }).click();
  const drawer = page.getByRole("dialog", { name: "Evidence" });
  await expect(drawer.locator("mark.sds-evidence__span")).toHaveText(mock.data.evidence[sig.evidence_ids[0]!]!.quote);
  await expect(drawer.locator(".sds-evidence__context")).toHaveCount(0);
});
