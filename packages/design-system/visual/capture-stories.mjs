#!/usr/bin/env node
// Capture screenshots of Storybook stories for review, for example for the progress report.
// Usage: node visual/capture-stories.mjs <baseUrl> <outDir> <storyId> [storyId ...]
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/pw-browsers")) process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";

const [base, outDir, ...ids] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const id of ids) {
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, `${id}.png`) });
  console.log(`captured ${id}`);
}
await browser.close();
