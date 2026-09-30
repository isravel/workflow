import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
});

test("keeps the timeline usable on a narrow viewport", async ({ page }) => {
  await expect(page.getByRole("link", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Statistics" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New activity" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test("keeps keyboard entry and focus behavior available on mobile", async ({ page }) => {
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "Capture the block." });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Title")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("maintains readable text contrast in both themes", async ({ page }) => {
  const contrastRatio = (foreground: string, background: string) => {
    const channel = (value: string) => {
      const normalized = Number(value) / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const parse = (value: string) => value.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    const foregroundRgb = parse(foreground).map((value) => channel(String(value)));
    const backgroundRgb = parse(background).map((value) => channel(String(value)));
    const foregroundLum = 0.2126 * foregroundRgb[0] + 0.7152 * foregroundRgb[1] + 0.0722 * foregroundRgb[2];
    const backgroundLum = 0.2126 * backgroundRgb[0] + 0.7152 * backgroundRgb[1] + 0.0722 * backgroundRgb[2];
    return (Math.max(foregroundLum, backgroundLum) + 0.05) / (Math.min(foregroundLum, backgroundLum) + 0.05);
  };

  const getRatios = () => page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const subtitle = document.querySelector("p[class*='subtitle']");
    return {
      bodyText: body.color,
      bodyBackground: body.backgroundColor,
      mutedText: subtitle ? getComputedStyle(subtitle).color : body.color,
    };
  });

  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") await page.getByRole("button", { name: "Switch to dark theme" }).click();
    const colors = await getRatios();
    expect(contrastRatio(colors.bodyText, colors.bodyBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.mutedText, colors.bodyBackground)).toBeGreaterThanOrEqual(4.5);
  }
});
