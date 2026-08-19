import { expect, test } from "@playwright/test";
import { collectBrowserIssues, login } from "./helpers";

test.describe("compact notifications layout", () => {
  test("keeps common settings visible and advanced delivery collapsed", async ({ page }) => {
    const browserIssues = collectBrowserIssues(page);
    await login(page);
    await page.goto("/notifications");

    await expect(page.getByRole("heading", { name: "Keywords" })).toBeVisible();
    await expect(page.locator("#keyword-input")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Desktop alerts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Event delivery" })).toBeVisible();

    const deliverySections = page.locator("details.notification-section");
    await expect(deliverySections).toHaveCount(2);
    await expect(deliverySections.nth(0)).not.toHaveAttribute("open", "");
    await expect(deliverySections.nth(1)).not.toHaveAttribute("open", "");
    await expect(page.locator("#save-webhook")).not.toBeVisible();
    await expect(page.locator("#save-telegram")).not.toBeVisible();

    await deliverySections.nth(0).locator(":scope > summary").click();
    await expect(page.locator("#save-webhook")).toBeVisible();
    await expect(page.locator("#webhook-url")).toBeVisible();
    await expect(page.locator("#webhook-template")).not.toBeVisible();
    await deliverySections.nth(0).locator("details.notification-advanced > summary").click();
    await expect(page.getByRole("textbox", { name: "Editor content" })).toBeVisible();

    await expect(page.locator(".ui-help[title]")).toHaveCount(9);
    await expect(page.getByText("Fire when a client connects")).toHaveCount(0);
    await expect(page.getByText("Your personal webhook")).toHaveCount(0);
    expect(browserIssues).toEqual([]);
  });

  test("fits opened settings on a phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const browserIssues = collectBrowserIssues(page);
    await login(page);
    await page.goto("/notifications");

    const webhook = page.locator("details.notification-section").first();
    await webhook.locator(":scope > summary").click();
    await webhook.locator("details.notification-advanced > summary").click();
    await expect(page.getByRole("textbox", { name: "Editor content" })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.body).toBeLessThanOrEqual(1);
    expect(overflow.root).toBeLessThanOrEqual(1);
    expect(browserIssues).toEqual([]);
  });
});
