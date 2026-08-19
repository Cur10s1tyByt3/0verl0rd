import { expect, test } from "@playwright/test";
import { collectBrowserIssues, login } from "./helpers";

test.describe("cross-page UI polish", () => {
  test("rounds notification panels and normalizes graph fields", async ({ page }) => {
    const browserIssues = collectBrowserIssues(page);
    await login(page);

    await page.goto("/notifications");
    const notificationRadius = await page.locator("#keyword-section").evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
    );
    const deliveryRadius = await page.locator("details.notification-section").first().evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
    );
    expect(notificationRadius).toBeGreaterThanOrEqual(14);
    expect(deliveryRadius).toBeGreaterThanOrEqual(14);

    await page.goto("/graph");
    const graphColors = await page.evaluate(() => {
      const field = document.querySelector(".graph-field");
      const input = document.querySelector("#graph-search");
      const select = document.querySelector("#graph-status");
      if (!field || !input || !select) throw new Error("Graph controls are missing");
      return {
        field: getComputedStyle(field).backgroundColor,
        input: getComputedStyle(input).backgroundColor,
        select: getComputedStyle(select).backgroundColor,
      };
    });
    expect(graphColors.input).toBe("rgba(0, 0, 0, 0)");
    expect(graphColors.field).toBe(graphColors.select);

    await page.locator("#graph-search").fill("example");
    await expect(page.locator("#graph-search")).toHaveValue("example");
    expect(browserIssues).toEqual([]);
  });

  test("spaces the File Share empty state and fits on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const browserIssues = collectBrowserIssues(page);
    await login(page);
    await page.goto("/file-share");

    const emptyState = page.locator(".file-share-empty");
    await expect(emptyState).toBeVisible();
    const filePickerColors = await page.locator("#upload-file").evaluate((element) => ({
      field: getComputedStyle(element).backgroundColor,
      button: getComputedStyle(element, "::file-selector-button").backgroundColor,
    }));
    expect(filePickerColors.button).toBe("rgba(0, 0, 0, 0)");
    expect(filePickerColors.field).not.toBe(filePickerColors.button);
    await page.locator("#upload-file").hover();
    const iconBox = await emptyState.locator("i").boundingBox();
    const labelBox = await emptyState.locator("span").boundingBox();
    expect(iconBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(labelBox!.y - (iconBox!.y + iconBox!.height)).toBeGreaterThanOrEqual(11);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(browserIssues).toEqual([]);
  });
});
