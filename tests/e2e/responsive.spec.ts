import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const routes = ["/", "/search", "/statistics", "/settings"] as const;

test("keeps every primary route usable at supported viewport sizes", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      expect(dimensions.document, `${viewport.name} ${route} should not overflow the document`).toBeLessThanOrEqual(dimensions.viewport + 1);
      if (route === "/") {
        await expect(page.getByRole("button", { name: "New activity" })).toBeVisible();
      }
      if (route === "/search") await expect(page.getByLabel("Search activities")).toBeVisible();
      if (route === "/statistics") await expect(page.getByText("Tracked time")).toBeVisible();
      if (route === "/settings") await expect(page.getByLabel("Timezone")).toBeVisible();
    }
  }
});
