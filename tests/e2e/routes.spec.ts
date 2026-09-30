import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const clearActivityStorage = async (page: Page) => {
  await page.evaluate(async () => {
    window.localStorage.clear();
    window.localStorage.setItem("workflow.testClock", String(Date.parse("2026-09-18T12:00:00+05:30")));
    await new Promise<void>((resolve) => {
      const request = window.indexedDB.deleteDatabase("workflow-journal");
      request.onsuccess = request.onerror = () => resolve();
    });
  });
};

const openSettingsTab = async (page: Page, tab: string) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: new RegExp(tab) }).click();
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
  await clearActivityStorage(page);
  await page.reload();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
});

test("searches persisted activities and links back to their timeline date", async ({ page }) => {
  await page.getByRole("button", { name: "New activity" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture the block." });
  await dialog.getByLabel("Title").fill("Route research");
  await dialog.getByLabel("Duration").fill("30m");
  await dialog.getByRole("button", { name: "Create activity" }).click();

  await page.goto("/search");
  await page.getByLabel("Search activities").fill("route research");
  const result = page.getByRole("link", { name: /Route research/ });
  await expect(result).toBeVisible();
  await expect(result).toContainText("Deep Work");
  await result.click();

  await expect(page).toHaveURL(/\/\?date=2026-09-18$/);
  await expect(page.getByRole("group", { name: /Route research, Deep Work/ })).toBeVisible();
});

test("migrates legacy activity data into local storage", async ({ page }) => {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = window.indexedDB.open("workflow-journal", 2);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("activities", { keyPath: "id" }).put({
          id: "legacy-activity",
          title: "Legacy activity",
          startAt: "2026-09-18T09:00:00+05:30",
          endAt: "2026-09-18T09:30:00+05:30",
          categoryId: "deep-work",
          notes: "",
          tags: [],
        });
      };
      request.onsuccess = () => {
        request.result.close();
        window.localStorage.removeItem("workflow.activities");
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });

  await page.reload();
  await expect(page.getByRole("group", { name: /Legacy activity, Deep Work/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("workflow.activities"))).not.toBeNull();
});

test("calculates statistics from persisted activities including a running activity", async ({ page }) => {
  await page.keyboard.press("t");
  await page.goto("/statistics");

  await expect(page.getByText("Tracked time")).toBeVisible();
  await expect(page.getByText("Recent days")).toBeVisible();
  await expect(page.getByRole("link", { name: "2026-09-18" })).toBeVisible();
  await expect(page.getByText("Deep work", { exact: true })).toBeVisible();
});

test("shows an empty state when persisted activities are empty", async ({ page }) => {
  await page.goto("/search");
  await page.evaluate(() => window.localStorage.removeItem("workflow.activities"));
  await page.reload();

  await expect(page.getByText("No activities match those filters.")).toBeVisible();
});

test("exports and imports a validated activity backup", async ({ page }) => {
  await page.getByRole("button", { name: "New activity" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture the block." });
  await dialog.getByLabel("Title").fill("Backup round trip");
  await dialog.getByLabel("Duration").fill("30m");
  await dialog.getByRole("button", { name: "Create activity" }).click();

  await openSettingsTab(page, "Data");
  await expect(page.getByRole("button", { name: "Export backup" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("workflow.activities"))).not.toBeNull();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^workflow-journal-\d{4}-\d{2}-\d{2}\.json$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  if (!downloadPath) return;
  const backup = await readFile(downloadPath, "utf8");
  const parsed = JSON.parse(backup) as { format: string; version: number; activities: Array<{ title: string }>; tasks: unknown[] };
  expect(parsed.format).toBe("workflow-journal");
  expect(parsed.version).toBe(2);
  expect(parsed.tasks).toEqual([]);
  expect(parsed.activities.some((activity) => activity.title === "Backup round trip")).toBe(true);

  await clearActivityStorage(page);
  await page.reload();
  await page.getByRole("tab", { name: /Data/ }).click();
  await expect(page.getByRole("button", { name: "Import backup" })).toBeVisible();
  page.once("dialog", (browserDialog) => browserDialog.accept());
  await page.getByLabel("Choose activity backup").setInputFiles({
    name: "workflow-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup),
  });
  await expect(page.getByRole("status")).toContainText("Imported");

  await page.goto("/search");
  await expect(page.getByRole("link", { name: /Backup round trip/ })).toBeVisible();
});

test("creates, updates, and links a future task to an activity", async ({ page }) => {
  await page.getByRole("button", { name: "Tasks" }).click();
  const drawer = page.getByRole("complementary", { name: "Task manager" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Add task" }).click();
  await drawer.getByLabel("Title").fill("Prepare release notes");
  await drawer.getByLabel(/Due date/).fill("2026-09-25");
  await drawer.getByLabel("Description").fill("Collect the changes for the next release.");
  await drawer.getByRole("button", { name: "Add task" }).click();

  await expect(drawer.getByText("Prepare release notes", { exact: true })).toBeVisible();
  await drawer.getByRole("combobox", { name: "Status for Prepare release notes" }).selectOption("in-progress");
  await expect(drawer.locator("span").filter({ hasText: /^In progress$/ })).toBeVisible();

  await drawer.getByRole("button", { name: "Log activity" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture the block." });
  await dialog.getByLabel("Title").fill("Release notes review");
  await dialog.getByLabel("Duration").fill("30m");
  await dialog.locator("select[name='quick-entry-task']").selectOption({ label: "Prepare release notes · In progress" });
  await dialog.getByRole("button", { name: "Create activity" }).click();

  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem("workflow.activities") ?? "{}");
    return {
      taskTitle: stored.tasks?.[0]?.title,
      taskStatus: stored.tasks?.[0]?.status,
      activityTaskId: stored.activities?.find((activity: { title: string }) => activity.title === "Release notes review")?.taskId,
    };
  })).toEqual({
    taskTitle: "Prepare release notes",
    taskStatus: "in-progress",
    activityTaskId: expect.any(String),
  });

  await page.reload();
  await page.getByRole("button", { name: /Tasks/ }).click();
  await expect(page.getByRole("complementary", { name: "Task manager" }).getByText("Prepare release notes", { exact: true })).toBeVisible();
});

test("rejects malformed activity backups without replacing stored data", async ({ page }) => {
  await page.getByRole("button", { name: "New activity" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture the block." });
  await dialog.getByLabel("Title").fill("Existing activity");
  await dialog.getByLabel("Duration").fill("30m");
  await dialog.getByRole("button", { name: "Create activity" }).click();

  await openSettingsTab(page, "Data");
  page.once("dialog", (browserDialog) => browserDialog.accept());
  await page.getByLabel("Choose activity backup").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "not-workflow", version: 1, activities: [] })),
  });

  await expect(page.getByRole("status")).toHaveText("The selected backup is not a compatible WorkFlow Journal backup.");
  await page.goto("/search");
  await expect(page.getByRole("link", { name: /Existing activity/ })).toBeVisible();
});

test("persists timeline visibility and timezone preferences", async ({ page }) => {
  await openSettingsTab(page, "Timeline");
  await page.getByLabel("From").selectOption("09:00");
  await page.locator("label").filter({ hasText: "To" }).locator("select").selectOption("18:00");
  await page.getByLabel("Snap interval").selectOption("30");
  await page.getByLabel("Timezone").selectOption("UTC");
  await page.getByRole("tab", { name: /Categories/ }).click();
  await page.getByRole("checkbox", { name: "Admin" }).uncheck();
  await page.reload();

  await expect(page.getByLabel("From")).toHaveValue("09:00");
  await expect(page.locator("label").filter({ hasText: "To" }).locator("select")).toHaveValue("18:00");
  await expect(page.getByLabel("Snap interval")).toHaveValue("30");
  await expect(page.getByLabel("Timezone")).toHaveValue("UTC");
  await page.getByRole("tab", { name: /Categories/ }).click();
  await expect(page.getByRole("checkbox", { name: "Admin" })).not.toBeChecked();

  await page.goto("/");
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
  await expect(page.getByText("UTC", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: /Documentation, Admin/ })).toHaveCount(0);
});

test("persists global category color and priority defaults", async ({ page }) => {
  await openSettingsTab(page, "Categories");
  await page.getByLabel("Development color").selectOption("red-600");
  await page.getByLabel("Development default priority").selectOption("high");
  await page.reload();
  await page.getByRole("tab", { name: /Categories/ }).click();

  await expect(page.getByLabel("Development color")).toHaveValue("red-600");
  await expect(page.getByLabel("Development default priority")).toHaveValue("high");

  await page.goto("/");
  await page.getByRole("button", { name: "New activity" }).click();
  const quickEntry = page.getByRole("dialog", { name: "Capture the block." });
  await quickEntry.getByLabel("Title").fill("Global category default");
  await quickEntry.getByLabel("Duration").fill("30m");
  await quickEntry.getByText("Development", { exact: true }).click();
  await quickEntry.getByRole("button", { name: "Create activity" }).click();

  const activity = page.getByRole("group", { name: /Global category default, Development/ });
  await expect(activity).toHaveCSS("border-left-color", "rgb(219, 49, 54)");
  await activity.press("Enter");
  await expect(page.getByRole("radio", { name: "High" })).toBeChecked();
});

test("adds and removes managed categories and priorities", async ({ page }) => {
  await openSettingsTab(page, "Categories");
  
  await page.getByLabel("New category name").fill("Client work");
  await page.getByLabel("New category color").selectOption("red-600");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByLabel("Client work color")).toHaveValue("red-600");

  await page.getByRole("tab", { name: /Priorities/ }).click();
  await page.getByLabel("New priority name").fill("Urgent");
  await page.getByRole("button", { name: "Add priority" }).click();
  await expect(page.getByRole("button", { name: "Remove urgent priority" })).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: /Categories/ }).click();
  await expect(page.getByLabel("Client work color")).toHaveValue("red-600");
  await page.getByRole("tab", { name: /Priorities/ }).click();
  await expect(page.getByRole("button", { name: "Remove urgent priority" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "New activity" }).click();
  const quickEntry = page.getByRole("dialog", { name: "Capture the block." });
  await quickEntry.getByLabel("Title").fill("Managed category activity");
  await quickEntry.getByLabel("Duration").fill("30m");
  await quickEntry.getByText("Client work", { exact: true }).click();
  await quickEntry.getByRole("button", { name: "Create activity" }).click();
  const activity = page.getByRole("group", { name: /Managed category activity, Client work/ });
  await expect(activity).toBeVisible();
  await activity.press("Enter");
  await expect(page.getByRole("radio", { name: "Urgent" })).toBeVisible();

  await openSettingsTab(page, "Categories");
  await page.getByRole("button", { name: "Remove Client work category" }).click();
  await page.getByRole("tab", { name: /Priorities/ }).click();
  await page.getByRole("button", { name: "Remove urgent priority" }).click();
  await page.getByRole("tab", { name: /Categories/ }).click();
  await expect(page.getByLabel("Client work color")).toHaveCount(0);
  await page.getByRole("tab", { name: /Priorities/ }).click();
  await expect(page.getByRole("button", { name: "Remove urgent priority" })).toHaveCount(0);
});
