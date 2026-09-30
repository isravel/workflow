import { expect, test } from "@playwright/test";

test("exposes an installable manifest and registers the service worker", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();

  const manifest = await page.evaluate(async () => {
    const response = await fetch("/manifest.webmanifest");
    return response.json() as Promise<{ name: string; display: string; start_url: string; icons: Array<{ src: string }> }>;
  });

  expect(manifest.name).toBe("WorkFlow Journal");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  expect(manifest.icons).toHaveLength(2);
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  })).toBe(true);
});

test("keeps the journal usable and local while offline", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Offline — changes save on this device.")).toBeVisible();
  await expect(page.getByRole("button", { name: "New activity" })).toBeVisible();

  await page.getByRole("button", { name: "New activity" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture the block." });
  await dialog.getByLabel("Title").fill("Offline activity");
  await dialog.getByLabel("Duration").fill("30m");
  await dialog.getByRole("button", { name: "Create activity" }).click();
  await expect(page.getByRole("group", { name: /Offline activity/ })).toBeVisible();

  await page.goto("/search");
  await expect(page.getByLabel("Search activities")).toBeVisible();
  await page.getByLabel("Search activities").fill("Offline activity");
  await expect(page.getByRole("link", { name: /Offline activity/ })).toBeVisible();
});
