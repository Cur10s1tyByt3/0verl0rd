import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
);

test("easter egg image is requested only after browser-local opt-in", async ({ page }) => {
  let imageRequests = 0;
  await page.route("**/assets/console.gif", async (route) => {
    imageRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "image/gif",
      body: TRANSPARENT_GIF,
    });
  });

  await login(page);
  expect(imageRequests).toBe(0);

  await page.goto("/settings");
  const toggle = page.locator("#easter-egg-enabled");
  const status = page.locator("#easter-egg-status");
  await expect(toggle).not.toBeChecked();

  await toggle.check();
  await expect(status).toContainText("Enabled and shown");
  expect(imageRequests).toBe(1);

  await page.reload();
  await expect(toggle).toBeChecked();
  expect(imageRequests).toBe(1);

  await toggle.uncheck();
  await expect(status).toContainText("will not be requested");
  await page.reload();
  await expect(toggle).not.toBeChecked();
  expect(imageRequests).toBe(1);
});
