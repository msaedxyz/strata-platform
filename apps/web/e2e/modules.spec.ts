// docs/07 criterion 8: each module in the table works with fixture data and has an end to end test.
// The data is the small fixture dataset (e2e/fixtures/small-dataset.json) behind the mocked API (e2e/mock-api.ts).
import type { Page } from "@playwright/test";
import { addPanel, expect, moduleReady, openWorkspace, panel, test } from "./harness";

const toast = (page: Page, text: string) => page.locator(".sds-toast-region").getByText(text, { exact: true });

test.describe("criterion 8: modules with fixture data", () => {
  test("ticker strip: the latest Tier 0 and Tier 1 signals, the counts by tier, and a signal opens with its evidence", async ({ page, mock }) => {
    // With reduced motion the strip does not move, so the test can click an item.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWorkspace(page, "monitoring");
    const m = await moduleReady(page, "ticker");
    const expected = mock.data.signals.filter((s) => s.tier <= 1).length;
    await expect(m.locator(".sds-ticker__list").first().locator(".sds-ticker__item")).toHaveCount(expected);
    await expect(m.locator(".sds-ticker__counts")).toContainText("T0 24h");
    await expect(m.locator(".sds-ticker__counts")).toContainText("T1 24h");
    // The shell ticker slot shows the same data.
    await expect(page.locator('section[aria-label="Latest Tier 0 and Tier 1 signals"] .sds-ticker__item').first()).toBeVisible();
    await m.locator(".sds-ticker__link").first().click();
    const drawer = page.getByRole("dialog", { name: "Signal" });
    await expect(drawer.locator("mark.sds-evidence__span")).toBeVisible();
    await expect(drawer.getByRole("link", { name: /Open source/ })).toHaveAttribute("href", /fixtures\.strata\.test/);
  });

  test("Tier 0 alerts: the status badge, and an analyst acknowledges an alert", async ({ page, api }) => {
    await openWorkspace(page, "monitoring");
    const m = await moduleReady(page, "tier0-alerts");
    await expect(m.locator("article")).toHaveCount(10);
    const first = m.locator('[data-alert-id="alert-000"]');
    await expect(first.locator('[data-status="unconfirmed"]')).toHaveText("Unconfirmed");
    await expect(m.locator('[data-status="false_positive"]')).toHaveText("False positive");
    // An analyst sees Acknowledge. Confirm and Dismiss are for approvers only (docs/06).
    await expect(m.getByRole("button", { name: "Confirm" })).toHaveCount(0);
    await first.getByRole("button", { name: "Acknowledge" }).click();
    await expect(toast(page, "Acknowledged")).toBeVisible();
    await expect(first.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
    await expect(first).toContainText("Acknowledged");
    expect(api.writes.map((w) => w.path)).toContain("/api/alerts/alert-000/acknowledge");
  });

  test.describe("as an approver", () => {
    test.use({ role: "approver" });
    test("Tier 0 alerts: an approver confirms one alert and dismisses another as a false positive", async ({ page, api }) => {
      await openWorkspace(page, "monitoring");
      const m = await moduleReady(page, "tier0-alerts");
      const a0 = m.locator('[data-alert-id="alert-000"]');
      await a0.getByRole("button", { name: "Confirm" }).click();
      const confirm = page.getByRole("dialog", { name: "Confirm alert" });
      await confirm.getByLabel("Reason").fill("Two sources report the suspension.");
      await confirm.getByRole("button", { name: "Confirm" }).click();
      await expect(toast(page, "Confirmed")).toBeVisible();
      await expect(a0.locator('[data-status="confirmed"]')).toBeVisible();
      const a1 = m.locator('[data-alert-id="alert-001"]');
      await a1.getByRole("button", { name: "Dismiss" }).click();
      const dismiss = page.getByRole("dialog", { name: "Dismiss alert" });
      await dismiss.getByLabel("Reason").fill("Wrong site.");
      await dismiss.getByLabel("False positive").check();
      await dismiss.getByRole("button", { name: "Dismiss" }).click();
      await expect(toast(page, "Dismissed")).toBeVisible();
      await expect(a1.locator('[data-status="false_positive"]')).toBeVisible();
      expect(api.writes.find((w) => w.path === "/api/alerts/alert-001/dismiss")?.body).toEqual({ reason: "Wrong site.", false_positive: true });
    });
  });

  test("demand drivers: market events with the direction, the certainty and the weekly trend", async ({ page, mock }) => {
    await openWorkspace(page, "monitoring");
    const m = await moduleReady(page, "demand-drivers");
    await expect(m.locator("article")).toHaveCount(mock.data.drivers.length);
    await expect(m.getByText("Energy Regulation Board raises the diesel pump price by 4 percent")).toBeVisible();
    await expect(m.locator(".sds-badge", { hasText: "Demand up" }).first()).toBeVisible();
    await expect(m.locator('[data-status="reported"]').first()).toBeVisible();
    await expect(m.getByRole("img", { name: /Demand drivers per week/ })).toBeVisible();
  });

  test("site watch list: daily and weekly lists, the pending status in the unverified style, and the site drawer", async ({ page, mock }) => {
    await openWorkspace(page, "monitoring");
    const m = await moduleReady(page, "site-watch-list");
    const daily = mock.data.sites.filter((s) => s.watch === "daily").length;
    await expect(m.getByRole("tab", { name: /Daily/ })).toContainText(String(daily));
    await expect(m.getByRole("table")).toHaveAttribute("aria-rowcount", String(daily));
    const row = m.locator('[data-row-id="mopani_nkana"]');
    await expect(row.locator('[data-status="pending"]')).toHaveText("Suspended, pending");
    // docs/07 rule 4: the pending status has the same visual style as unconfirmed and reported items.
    const pendingClass = await row.locator('[data-status="pending"]').getAttribute("class");
    expect(pendingClass).toContain("sds-badge--unverified");
    await m.getByRole("tab", { name: /Weekly/ }).click();
    await expect(m.getByRole("table")).toHaveAttribute("aria-rowcount", String(mock.data.sites.filter((s) => s.watch === "weekly").length));
    await m.getByRole("tab", { name: /Daily/ }).click();
    await m.locator('[data-row-id="kansanshi"]').click();
    const drawer = page.getByRole("dialog", { name: "Site" });
    await expect(drawer.locator("[data-entity-id='kansanshi']")).toHaveText("Kansanshi mine");
    await expect(drawer.getByRole("button", { name: /Show evidence for Operator/ })).toBeVisible();
  });

  test("signal feed: filters by tier, sector, geography and text, from the taxonomy", async ({ page, mock, api }) => {
    await openWorkspace(page, "monitoring");
    const m = await moduleReady(page, "signal-feed");
    const total = mock.data.signals.length;
    await expect(m.locator("[data-signal-total]")).toHaveText(`${total} of ${total}`);
    await m.getByLabel("Tier").selectOption("0");
    const t0 = mock.data.signals.filter((s) => s.tier === 0).length;
    await expect(m.locator("[data-signal-total]")).toHaveText(`${t0} of ${t0}`);
    await expect(m.locator("article .sds-badge", { hasText: /^T[12]$/ })).toHaveCount(0);
    await m.getByLabel("Tier").selectOption("");
    await m.getByLabel("Sector").selectOption("power");
    const power = mock.data.signals.filter((s) => s.sectors.includes("power")).length;
    await expect(m.locator("[data-signal-total]")).toHaveText(`${power} of ${power}`);
    await m.getByLabel("Sector").selectOption("");
    await m.getByLabel("Geography").selectOption({ label: "Copperbelt Province" });
    const cb = mock.data.signals.filter((s) => s.geographies.includes("prov_copperbelt")).length;
    await expect(m.locator("[data-signal-total]")).toHaveText(`${cb} of ${cb}`);
    await m.getByLabel("Geography").selectOption("");
    await m.getByRole("searchbox", { name: "Search signals" }).fill("haulage");
    const hits = mock.data.signals.filter((s) => s.title.toLowerCase().includes("haulage")).length;
    await expect(m.locator("[data-signal-total]")).toHaveText(`${hits} of ${hits}`);
    expect(api.calls.filter((c) => c === "GET /api/config/taxonomy").length).toBeGreaterThanOrEqual(1);
  });

  test("geographic deal map: sites on the country outlines, the site class filter, and a click opens the site drawer", async ({ page, mock }) => {
    await openWorkspace(page, "origination");
    const m = await moduleReady(page, "deal-map");
    const withCoords = mock.data.sites.filter((s) => s.lat !== null).length;
    await expect(m.locator(".sds-map-marker")).toHaveCount(withCoords, { timeout: 15_000 });
    await expect(m.locator("canvas.maplibregl-canvas")).toBeVisible();
    await m.getByLabel("Site class").selectOption("border");
    const borders = mock.data.sites.filter((s) => s.lat !== null && s.site_class === "border").length;
    await expect(m.locator(".sds-map-marker")).toHaveCount(borders);
    await m.getByLabel("Site class").selectOption("");
    await expect(m.locator(".sds-map-marker")).toHaveCount(withCoords);
    await m.locator('[data-marker-id="lumwana"]').click();
    const drawer = page.getByRole("dialog", { name: "Site" });
    await expect(drawer.locator("[data-entity-id='lumwana']")).toHaveText("Lumwana mine");
    await expect(drawer.getByRole("table", { name: "Opportunities at the site" })).toBeVisible();
  });

  test("kanban stage board: one column for each stage in config/stages.yaml, and the pending card", async ({ page, mock }) => {
    await openWorkspace(page, "relationships");
    const m = await moduleReady(page, "kanban");
    const cols = m.locator("[data-column-id]");
    await expect(cols).toHaveCount(mock.data.stages.deal_stages.length);
    await expect(cols.locator(".sds-kanban__title")).toHaveText(mock.data.stages.deal_stages.map((s) => s.name));
    const pending = mock.data.deals.find((d) => d.stage_pending)!;
    const card = m.locator(`[data-card-id="${pending.id}"]`);
    await expect(card).toContainText("Pending approval");
    await expect(m.locator(`[data-column-id="${pending.stage}"] [data-card-id="${pending.id}"]`)).toBeVisible();
    await expect(card).toHaveAttribute("draggable", "true");
  });

  test("priority list: ranked opportunities, and a row opens the breakdown of the score", async ({ page, mock }) => {
    await openWorkspace(page, "origination");
    const m = await moduleReady(page, "priority-list");
    const open = mock.data.deals.filter((d) => !["won", "lost", "parked"].includes(d.stage)).sort((a, b) => b.priority_score! - a.priority_score!);
    await expect(m.getByRole("table")).toHaveAttribute("aria-rowcount", String(open.length));
    const rows = m.locator("tbody tr[data-row-id]");
    await expect(rows.first()).toHaveAttribute("data-row-id", open[0]!.id);
    await expect(m.getByText("No contact found").first()).toBeVisible();
    await rows.first().click();
    const drawer = page.getByRole("dialog", { name: "Priority breakdown" });
    const chart = drawer.getByRole("figure", { name: "Priority score breakdown" });
    for (const part of ["Lead time", "Demand estimate", "Confidence", "Buyer fit"]) await expect(chart.getByText(part, { exact: true })).toBeVisible();
  });

  test("project pipeline: projects by lifecycle stage with the engagement window marked", async ({ page, mock }) => {
    await openWorkspace(page, "origination");
    const m = await moduleReady(page, "project-pipeline");
    await expect(m.locator("[data-engagement-window]")).toHaveText("Engagement window: Feasibility study to Financing close or final investment decision");
    const chart = m.getByRole("figure", { name: "Projects by lifecycle stage" });
    await expect(chart.locator("li")).toHaveCount(mock.data.stages.lifecycle_stages.length);
    await expect(chart.getByText(/\(window\)$/)).toHaveCount(5);
    await expect(m.getByRole("table", { name: "Projects" })).toHaveAttribute("aria-rowcount", String(mock.data.projects.length));
    await expect(m.getByText("In window").first()).toBeVisible();
  });

  test("procurement calendar: forecast windows on a 24 month axis, intervals and evidence in the drawer, stage only without a date", async ({ page, mock }) => {
    await openWorkspace(page, "origination");
    const m = await moduleReady(page, "procurement-calendar");
    const axis = m.getByRole("figure", { name: "Forecast procurement windows" });
    await expect(axis.locator(".sds-timeline__month")).toHaveCount(24);
    const dated = mock.data.projects.filter((p) => p.forecast_start);
    await expect(axis.locator("button.sds-timeline__range")).toHaveCount(dated.length);
    await expect(m.getByRole("table", { name: "Projects without a forecast date" })).toHaveAttribute("aria-rowcount", String(mock.data.projects.length - dated.length));
    await axis.locator("button.sds-timeline__range").first().click();
    const drawer = page.getByRole("dialog", { name: "Forecast window" });
    await expect(drawer.getByRole("table", { name: "Forecast intervals" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: /Show evidence for Forecast procurement window/ })).toBeVisible();
  });

  test("next actions: by due date, overdue marked, and a row selects the opportunity for the relationship panel", async ({ page, mock }) => {
    await openWorkspace(page, "relationships");
    const m = await moduleReady(page, "next-actions");
    const withAction = mock.data.deals.filter((d) => d.next_action);
    await expect(m.getByRole("table")).toHaveAttribute("aria-rowcount", String(withAction.length));
    await expect(m.getByText("Overdue").first()).toBeVisible();
    const first = [...withAction].sort((a, b) => a.next_action!.due_date.localeCompare(b.next_action!.due_date))[0]!;
    await expect(m.locator("tbody tr[data-row-id]").first()).toHaveAttribute("data-row-id", first.id);
    await m.locator(`[data-row-id="${first.id}"]`).click();
    const rel = await moduleReady(page, "relationship-panel");
    await expect(rel.getByLabel("Opportunity")).toHaveValue(first.id);
  });

  test("approval queue: proposals with evidence; the analyst sees no decision buttons", async ({ page, mock }) => {
    await openWorkspace(page, "review");
    const m = await moduleReady(page, "approval-queue");
    await expect(m.locator("[data-proposal-id]")).toHaveCount(mock.data.proposals.length);
    const p2 = m.locator('[data-proposal-id="prop-002"]');
    await expect(p2.locator("mark.sds-evidence__span")).toHaveText(mock.data.evidence["ev-nkana-suspension"]!.quote);
    await expect(p2.getByRole("link", { name: /Open source/ })).toHaveAttribute("href", mock.data.evidence["ev-nkana-suspension"]!.url);
    await expect(m.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await expect(m.getByRole("button", { name: "Reject" })).toHaveCount(0);
  });

  test.describe("approval queue as an approver", () => {
    test.use({ role: "approver" });
    test("approve, reject with a required reason, edit and approve; no Approve on an own proposal", async ({ page, api }) => {
      await openWorkspace(page, "review");
      const m = await moduleReady(page, "approval-queue");
      // prop-005 was created by this approver (docs/06: a user never approves an own proposal).
      const own = m.locator('[data-proposal-id="prop-005"]');
      await expect(own.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
      await expect(own.getByRole("button", { name: "Edit and approve" })).toHaveCount(0);
      await expect(own.getByRole("button", { name: "Reject" })).toBeVisible();

      await m.locator('[data-proposal-id="prop-004"]').getByRole("button", { name: "Approve", exact: true }).click();
      await expect(toast(page, "Approved")).toBeVisible();
      await expect(m.locator('[data-proposal-id="prop-004"]')).toHaveCount(0);

      await m.locator('[data-proposal-id="prop-003"]').getByRole("button", { name: "Reject" }).click();
      const reject = page.getByRole("dialog", { name: "Reject" });
      await reject.getByRole("button", { name: "Reject" }).click();
      await expect(reject.getByText("Give a reason. A rejection needs a reason.")).toBeVisible();
      await reject.getByLabel("Reason").fill("The two names are different companies.");
      await reject.getByRole("button", { name: "Reject" }).click();
      await expect(toast(page, "Rejected")).toBeVisible();
      await expect(m.locator('[data-proposal-id="prop-003"]')).toHaveCount(0);

      await m.locator('[data-proposal-id="prop-002"]').getByRole("button", { name: "Edit and approve" }).click();
      const edit = page.getByRole("dialog", { name: "Edit and approve" });
      const text = edit.getByLabel("Events (JSON)");
      await text.fill((await text.inputValue()).replace('"to_status": "suspended"', '"to_status": "care_and_maintenance"'));
      await edit.getByRole("button", { name: "Edit and approve" }).click();
      await expect(toast(page, "Edited and approved")).toBeVisible();
      const body = api.writes.find((w) => w.path === "/api/proposals/prop-002/edit-approve")?.body as { events: Array<{ payload: { to_status: string }; evidence_ids: string[] }> };
      expect(body.events[0]!.payload.to_status).toBe("care_and_maintenance");
      expect(body.events[0]!.evidence_ids).toEqual(["ev-nkana-suspension"]);
    });
  });

  test("quarantine: rejected agent output with reason codes, a filter and the detail drawer", async ({ page, mock }) => {
    await openWorkspace(page, "review");
    const m = await moduleReady(page, "quarantine");
    await expect(m.getByRole("table")).toHaveAttribute("aria-rowcount", String(mock.data.quarantine.length));
    await m.getByRole("combobox", { name: "Reason code" }).selectOption("quote_not_in_source");
    await expect(m.getByRole("table")).toHaveAttribute("aria-rowcount", "1");
    await m.locator("tbody tr[data-row-id]").first().click();
    const drawer = page.getByRole("dialog", { name: "Quarantined output" });
    await expect(drawer.locator("[data-quarantine-id]")).toContainText("quote_not_in_source");
    await expect(drawer.getByLabel("Agent output")).toHaveValue(/fixture output/);
  });

  test("source health: the status of each source of the active brief and the known gaps", async ({ page, mock }) => {
    await openWorkspace(page, "monitoring");
    const m = await moduleReady(page, "source-health");
    const failed = mock.data.sources.filter((s) => s.last_status === "failed").length;
    await expect(m.getByRole("tab", { name: new RegExp(`Sources, ${failed} failed`) })).toBeVisible();
    await expect(m.getByRole("table")).toHaveAttribute("aria-rowcount", String(mock.data.sources.length));
    await expect(m.locator(".sds-badge", { hasText: "Failed" })).toHaveCount(failed);
    await m.getByRole("tab", { name: /Known gaps/ }).click();
    await expect(m.getByRole("table", { name: "Known gaps" })).toHaveAttribute("aria-rowcount", String(mock.data.knownGaps.length));
    await expect(m.getByText("Zambia Mining Cadastre")).toBeVisible();
  });

  test("alert telemetry: latency, time to acknowledgement, false positive rate by tier rule, and the timestamps", async ({ page, mock }) => {
    await openWorkspace(page, "review");
    const m = await moduleReady(page, "alert-telemetry");
    const metrics = m.getByRole("table", { name: "Alert metrics" });
    await expect(metrics).toContainText("Latency fetch to alert, median");
    await expect(metrics).toContainText("Time to acknowledgement, median");
    const fp = m.getByRole("figure", { name: "False positive rate by tier rule" });
    await expect(fp.locator("li")).toHaveCount(new Set(mock.data.alerts.map((a) => a.tier_rule)).size);
    await expect(fp).toContainText("25%");
    await m.getByRole("tab", { name: /Alerts/ }).click();
    const table = m.getByRole("table", { name: "Alert timestamps" });
    await expect(table).toHaveAttribute("aria-rowcount", String(mock.data.alerts.length));
    for (const h of ["Published", "Fetched", "Raised", "Delivered", "Acknowledged"]) await expect(table.getByRole("columnheader", { name: h })).toBeVisible();
  });

  test.describe("brief editor as an admin", () => {
    test.use({ role: "admin" });
    test("versions, differences, a new version with validation, and Activate", async ({ page, api }) => {
      await openWorkspace(page, "review");
      await addPanel(page, "brief-editor");
      const m = await moduleReady(page, "brief-editor");
      const versions = m.getByRole("table", { name: "Brief versions" });
      await expect(versions).toHaveAttribute("aria-rowcount", "2");
      await versions.locator('[data-row-id="brief-v1"]').getByRole("button", { name: "Activate" }).click();
      await expect(toast(page, "Activated")).toBeVisible();
      await expect(versions.locator('[data-row-id="brief-v1"]')).toContainText("Active");

      await m.getByRole("tab", { name: "Differences" }).click();
      const diff = m.getByRole("table", { name: "Differences between the versions" });
      await expect(diff.locator('[data-row-id]')).toHaveCount(2);
      await expect(diff).toContainText("version");

      await m.getByRole("tab", { name: "Edit" }).click();
      const yamlBox = m.getByLabel("Brief (YAML)");
      await expect(yamlBox).toHaveValue(/sources:/);
      await yamlBox.fill("version: 3\nname: broken\n");
      await m.getByRole("button", { name: "Create version" }).click();
      await expect(m.getByText("sources: the brief needs a sources section")).toBeVisible();
      await yamlBox.fill("version: 3\nname: Test\nsources:\n  news: []\n");
      await m.getByLabel("Change note").fill("Test version");
      await m.getByRole("button", { name: "Create version" }).click();
      await expect(toast(page, "Version created")).toBeVisible();
      await expect(versions).toHaveAttribute("aria-rowcount", "3");
      expect(api.writes.find((w) => w.path === "/api/briefs")).toBeTruthy();
    });
  });

  test("timeline: the events of the selected opportunity with evidence links (not live)", async ({ page }) => {
    await openWorkspace(page, "relationships");
    await addPanel(page, "timeline");
    const t = await moduleReady(page, "timeline");
    await expect(t.getByText("Nothing selected")).toBeVisible();
    await t.getByLabel("Opportunity").selectOption("deal-0003");
    await expect(t.locator('[data-event-type="DealIdentified"]')).toHaveCount(1);
    await expect(t.locator('[data-event-type="DealStageChanged"]').first()).toBeVisible();
    await expect(t.locator('[data-event-type="DealIdentified"]').getByRole("button", { name: /Show evidence/ })).toBeVisible();
    await expect(panel(page, "timeline").locator(".sds-badge", { hasText: "Live" })).toHaveCount(0);
  });
});

test.describe("criterion 8: loading, empty and error states", () => {
  test.use({ dataset: "empty" });
  test("each module in the four workspaces shows its empty state with no data", async ({ page }) => {
    for (const ws of ["origination", "relationships", "monitoring", "review"]) {
      await openWorkspace(page, ws);
      await expect(page.locator('[data-module-state="loading"]')).toHaveCount(0, { timeout: 15_000 });
      for (const id of await page.locator("[data-module]").evaluateAll((els) => els.map((e) => e.getAttribute("data-module")))) {
        // The board shows the empty stage columns, the map the country outlines, and the ticker its empty text.
        if (id === "kanban" || id === "deal-map") continue;
        if (id === "ticker") {
          await expect(page.locator('[data-module="ticker"]')).toContainText("No Tier 0 or Tier 1 signals yet");
          continue;
        }
        await expect(page.locator(`[data-module="${id}"]`), id!).toHaveAttribute("data-module-state", /empty|ready/);
        await expect(page.locator(`[data-module="${id}"] .sds-state--empty`).first(), id!).toBeVisible();
      }
    }
  });
});

test("an API error shows the error state with Retry, and Retry loads the data", async ({ page, mock }) => {
  mock.failures.set("/api/priority", 500);
  await openWorkspace(page, "origination");
  const m = page.locator('[data-module="priority-list"]');
  await expect(m).toHaveAttribute("data-module-state", "error");
  await expect(m.getByRole("alert")).toContainText("fixture failure");
  mock.failures.delete("/api/priority");
  await m.getByRole("button", { name: "Retry" }).click();
  await expect(m).toHaveAttribute("data-module-state", "ready");
});

test.describe("docs/07 rule 5 and docs/06: role-aware controls", () => {
  test.use({ role: "viewer" });
  test("a viewer sees no write controls: no Acknowledge, no card moves, no engagement forms", async ({ page }) => {
    await openWorkspace(page, "monitoring");
    const alerts = await moduleReady(page, "tier0-alerts");
    await expect(alerts.getByRole("button", { name: /Acknowledge|Confirm|Dismiss/ })).toHaveCount(0);
    await openWorkspace(page, "relationships");
    const k = await moduleReady(page, "kanban");
    await expect(k.locator('[draggable="true"]')).toHaveCount(0);
    const rel = await moduleReady(page, "relationship-panel");
    await rel.getByLabel("Opportunity").selectOption("deal-0002");
    await expect(rel.getByRole("tab", { name: /Contacts/ })).toBeVisible();
    await rel.getByRole("tab", { name: /Contacts/ }).click();
    await expect(rel.getByRole("button", { name: "Add contact" })).toHaveCount(0);
  });
});
