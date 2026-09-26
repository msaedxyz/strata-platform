// The shell: session start and end, live connection, role-aware controls.
import { expect, openWorkspace, panel, test } from "./harness";

test.describe("session", () => {
  test("after login the app calls POST /api/session/login and GET /api/me", async ({ page, api }) => {
    await openWorkspace(page);
    expect(api.calls).toContain("POST /api/session/login");
    expect(api.calls).toContain("GET /api/me");
    await expect(page.getByRole("button", { name: /E2E Analyst/ })).toContainText("Analyst");
  });

  test("logout calls POST /api/session/logout and ends the session", async ({ page, api }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: /E2E Analyst/ }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page.getByText("You are logged out.")).toBeVisible();
    expect(api.calls).toContain("POST /api/session/logout");
  });

  test("the live connection opens /api/live with the access token", async ({ page }) => {
    await openWorkspace(page);
    await expect(page.locator('[data-live-status="open"]')).toBeVisible();
    const urls = await page.evaluate(() => (window as unknown as { __liveUrls: string[] }).__liveUrls);
    expect(urls[0]).toMatch(/^\/api\/live\?access_token=e2e-mock-token/);
  });

  test("an unknown path goes to the default workspace", async ({ page }) => {
    await page.goto("/nothing-here");
    await expect(page).toHaveURL(/\/w\/origination$/);
  });

  test("the navigation changes the workspace and the browser back button returns", async ({ page }) => {
    await openWorkspace(page);
    await page.locator('[data-nav-id="monitoring"]').click();
    await expect(panel(page, "signal-feed")).toBeVisible();
    await page.goBack();
    await expect(panel(page, "priority-list")).toBeVisible();
  });
});

test.describe("role-aware controls: viewer", () => {
  test.use({ role: "viewer" });
  test("a viewer cannot add the brief editor (admin only)", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "Add panel" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add panel" });
    await expect(dialog.locator('[data-module-id="timeline"]')).toBeVisible();
    await expect(dialog.locator('[data-module-id="brief-editor"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("/");
    await page.keyboard.type("brief editor");
    await expect(page.getByRole("option")).toHaveCount(0);
  });
});

test.describe("role-aware controls: admin", () => {
  test.use({ role: "admin" });
  test("an admin can add the brief editor", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "Add panel" }).first().click();
    await page.getByRole("dialog", { name: "Add panel" }).locator('[data-module-id="brief-editor"]').click();
    await expect(panel(page, "brief-editor")).toBeVisible();
  });
});
