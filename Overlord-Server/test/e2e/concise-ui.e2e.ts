import { expect, test } from "@playwright/test";
import { collectBrowserIssues, login } from "./helpers";

test.describe("concise UI conventions", () => {
  test("removes redundant page copy and promotes section help", async ({ page }) => {
    const browserIssues = collectBrowserIssues(page);
    await login(page);

    await page.goto("/logs");
    await expect(page.getByRole("heading", { name: "Client Connection Logs" })).toBeVisible();
    await expect(page.getByText("Review connection lifecycle activity across enrolled clients.")).toHaveCount(0);
    const filterHelp = page.locator("h2", { hasText: "Filter activity" }).locator(".ui-help");
    await expect(filterHelp).toHaveAttribute("title", "Narrow results by client, time range, or event type.");
    await expect(page.getByText("Narrow results by client, time range, or event type.")).toHaveClass("sr-only");

    await page.goto("/plugins");
    await expect(page.getByRole("heading", { name: "Plugins", exact: true })).toBeVisible();
    await expect(page.getByText("Upload zip bundles and manage client plugins or server extensions")).toHaveCount(0);
    await expect(page.locator("h2", { hasText: "Upload" }).locator(".ui-help")).toHaveAttribute(
      "title",
      "Drag a plugin zip here or click to browse",
    );

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByText("Manage your account preferences, operational tools, and admin configuration.")).toHaveCount(0);
    await expect(page.locator("#section-account h2 .ui-help")).toHaveAttribute(
      "title",
      "View your account info and update your password.",
    );
    await expect(page.locator("#chat-retention-days")).toHaveAttribute(
      "title",
      "Messages older than this will be automatically deleted. Set to 0 to keep messages forever. Max 365 days.",
    );
    await page.waitForLoadState("networkidle");

    await page.goto("/build");
    await expect(page.getByText("Build customized Overlord client agents")).toHaveCount(0);
    const obfuscateOption = page.locator('label:has(input[name="obfuscate"])').first();
    await expect(obfuscateOption).toHaveAttribute("title", "Build with garble for code obfuscation");
    await expect(obfuscateOption.locator("span.sr-only")).toContainText("Build with garble");
    await page.waitForLoadState("networkidle");

    await page.goto("/purgatory");
    await page.locator("#auto-accept-toggle").click({ force: true });
    await expect(page.getByText("This disables all enrollment security.")).toBeVisible();
    await page.locator("#auto-accept-modal-cancel").click();

    expect(browserIssues).toEqual([]);
  });

  test("keeps compact help and controls usable at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const browserIssues = collectBrowserIssues(page);
    await login(page);
    await page.goto("/settings");

    await expect(page.locator("#section-account h2 .ui-help")).toBeVisible();
    await page.locator("#section-account h2 .ui-help").focus();
    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.body).toBeLessThanOrEqual(1);
    expect(overflow.root).toBeLessThanOrEqual(1);
    expect(browserIssues).toEqual([]);
  });
});
