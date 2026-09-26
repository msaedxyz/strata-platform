// docs/07 criterion 5 (against the mocked API only): a new event appears in its live module two seconds or less
// after the commit. Here the "commit" is the moment the mocked API has the new row and the live stream sends the
// event, as the database trigger event_notify does. The test on the real local stack comes in M7.
import type { Locator, Page } from "@playwright/test";
import type { LiveOut } from "./mock-api";
import { emitLive, expect, moduleReady, openWorkspace, test } from "./harness";

const LIMIT_MS = 2000;

/** Send the events and give the time until the locator is visible, in milliseconds. */
async function timeToVisible(page: Page, events: LiveOut[], target: Locator): Promise<number> {
  const start = Date.now();
  await emitLive(page, events);
  await expect(target).toBeVisible({ timeout: 5000 });
  return Date.now() - start;
}

const live = (type: string, streamType: string, streamId: string): LiveOut => ({ type, data: { id: `evt-${type}-${Date.now()}`, stream_type: streamType, stream_id: streamId, event_type: type } });

test.describe("criterion 5 (mocked API): live updates in 2 seconds or less", () => {
  test("a new signal appears in the signal feed and the ticker, a new Tier 0 alert appears as Unconfirmed, and a new demand driver appears", async ({ page, mock }) => {
    await openWorkspace(page, "monitoring");
    await moduleReady(page, "signal-feed");
    await moduleReady(page, "tier0-alerts");
    await moduleReady(page, "demand-drivers");

    const base = mock.data.signals[0]!;
    const now = new Date().toISOString();
    const signal = { ...base, id: "sig-live-1", title: "LIVE: Contract mining tender opens at Lumwana", tier: 0, published_at: now, recorded_at: now, event_id: "evt-live-sig" };
    mock.data.signals.unshift(signal);
    const feedItem = page.locator('[data-module="signal-feed"] [data-signal-id="sig-live-1"]');
    const t1 = await timeToVisible(page, [live("SignalScored", "signal", signal.id)], feedItem);
    await expect(feedItem).toHaveClass(/sds-feed-item--fresh/);
    await expect(page.locator('[data-module="ticker"]').getByText(signal.title).first()).toBeVisible();

    const alert = { ...mock.data.alerts[0]!, id: "alert-live-1", title: "LIVE: Sale process announced for a watched mine", status: "unconfirmed" as const, raised_at: now, acknowledged_at: null, decided_at: null };
    mock.data.alerts.push(alert);
    const alertItem = page.locator('[data-module="tier0-alerts"] [data-alert-id="alert-live-1"]');
    const t2 = await timeToVisible(page, [live("AlertRaised", "alert", alert.id)], alertItem);
    // docs/06 criterion 4 (UI part): the alert reaches the frontend with the status Unconfirmed, before any approval.
    await expect(alertItem.locator('[data-status="unconfirmed"]')).toBeVisible();

    const driver = { ...mock.data.drivers[0]!, event_id: "evt-drv-live", title: "LIVE: Fuel shortage at Ndola filling stations", observed_at: now, recorded_at: now };
    mock.data.drivers.unshift(driver);
    const t3 = await timeToVisible(page, [live("DemandDriverObserved", "market", "market")], page.locator('[data-module="demand-drivers"] [data-driver-id="evt-drv-live"]'));

    for (const [name, ms] of [["signal", t1], ["alert", t2], ["driver", t3]] as const) expect(ms, `${name}: ${ms} ms`).toBeLessThanOrEqual(LIMIT_MS);
  });

  test("a stage move by another analyst shows Pending approval on the Kanban card, and a site status proposal shows the pending status", async ({ page, mock }) => {
    await openWorkspace(page, "relationships");
    await moduleReady(page, "kanban");
    mock.userId = "analyst-2";
    const res = mock.handle("POST", "/api/deals/deal-0003/stage", new URLSearchParams(), { to_stage: "approach" });
    expect(res.status).toBe(200);
    const t1 = await timeToVisible(page, res.live!, page.locator('[data-card-id="deal-0003"]').getByText("Pending approval"));
    expect(t1, `kanban: ${t1} ms`).toBeLessThanOrEqual(LIMIT_MS);

    await openWorkspace(page, "monitoring");
    await moduleReady(page, "site-watch-list");
    mock.data.sites.find((s) => s.id === "kansanshi")!.status_pending = "care_and_maintenance";
    const t2 = await timeToVisible(page, [live("ProposalCreated", "proposal", "prop-live-site")], page.locator('[data-module="site-watch-list"] [data-row-id="kansanshi"] [data-status="pending"]'));
    expect(t2, `site watch list: ${t2} ms`).toBeLessThanOrEqual(LIMIT_MS);
  });

  test("an approved proposal leaves the approval queue and the telemetry counts a new acknowledgement", async ({ page, mock }) => {
    await openWorkspace(page, "review");
    const q = await moduleReady(page, "approval-queue");
    await moduleReady(page, "alert-telemetry");
    await expect(q.locator('[data-proposal-id="prop-004"]')).toBeVisible();
    mock.role = "approver";
    mock.userId = "approver-2";
    const res = mock.handle("POST", "/api/proposals/prop-004/approve", new URLSearchParams(), {});
    const start = Date.now();
    await emitLive(page, res.live!);
    await expect(q.locator('[data-proposal-id="prop-004"]')).toHaveCount(0, { timeout: 5000 });
    expect(Date.now() - start).toBeLessThanOrEqual(LIMIT_MS);

    const before = mock.telemetry().metrics.time_to_acknowledgement_seconds.n;
    mock.role = "analyst";
    const ack = mock.handle("POST", "/api/alerts/alert-000/acknowledge", new URLSearchParams(), {});
    const t = page.locator('[data-module="alert-telemetry"]').getByRole("table", { name: "Alert metrics" });
    const s2 = Date.now();
    await emitLive(page, ack.live!);
    await expect(t).toContainText(`${before + 1} of ${mock.data.alerts.length}`, { timeout: 5000 });
    expect(Date.now() - s2).toBeLessThanOrEqual(LIMIT_MS);
  });

  test("the timeline is not live: an event does not reload it", async ({ page, api }) => {
    await openWorkspace(page, "relationships");
    const k = await moduleReady(page, "kanban");
    await k.locator('[data-card-id="deal-0003"]').click();
    await page.getByRole("button", { name: "Add panel" }).first().click();
    await page.getByRole("dialog", { name: "Add panel" }).locator('[data-module-id="timeline"]').click();
    await moduleReady(page, "timeline");
    const before = api.calls.filter((c) => c === "GET /api/timeline").length;
    await emitLive(page, [live("DealStageChanged", "deal", "deal-0003")]);
    await page.waitForTimeout(800);
    expect(api.calls.filter((c) => c === "GET /api/timeline").length).toBe(before);
  });
});
