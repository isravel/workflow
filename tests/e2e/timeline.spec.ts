import { expect, test, type Page } from "@playwright/test";

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

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
  await clearActivityStorage(page);
  await page.reload();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
});

test("loads without the React inline-script console warning", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.reload();
  await expect(page.getByRole("region", { name: "Work timeline" })).toBeVisible();

  expect(consoleErrors).not.toContain(expect.stringContaining("Encountered a script tag while rendering React component"));
});

test("creates an activity by dragging across an empty day row", async ({ page }) => {
  const track = page.locator('[data-timeline-track="2026-09-19"]');
  await track.scrollIntoViewIfNeeded();
  const box = await track.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const startX = box.x + box.width * 0.2;
  const endX = box.x + box.width * 0.35;
  const y = box.y + box.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 4 });
  await page.mouse.up();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("New activity");
  await expect(page.getByLabel("Title")).toBeFocused();
});

test("uses a unique id when creating after a reload", async ({ page }) => {
  await page.getByRole("button", { name: "New activity" }).click();
  const firstDialog = page.getByRole("dialog", { name: "Capture the block." });
  await firstDialog.getByLabel("Title").fill("New activity");
  await firstDialog.getByRole("button", { name: "Create activity" }).click();
  await page.reload();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();

  await page.getByRole("button", { name: "New activity" }).click();
  const secondDialog = page.getByRole("dialog", { name: "Capture the block." });
  await secondDialog.getByLabel("Title").fill("New activity");
  await secondDialog.getByRole("button", { name: "Create activity" }).click();

  await expect(page.getByRole("group", { name: /New activity, Deep Work/ })).toHaveCount(2);
});

test("creates an activity from quick entry with a parsed duration", async ({ page }) => {
  await page.getByRole("button", { name: "New activity" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture the block." });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Title").fill("Quick planning");
  await dialog.getByLabel("Duration").fill("1h30");
  await dialog.getByText("Development", { exact: true }).click();
  await dialog.getByText("Blue", { exact: true }).click();
  await dialog.getByRole("button", { name: "Create activity" }).click();

  await expect(page.getByRole("group", { name: /Quick planning, Development, 12:00 PM – 1:30 PM/ })).toBeVisible();
});

test("cancels a new activity without saving it", async ({ page }) => {
  await page.getByRole("button", { name: "New activity" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture the block." });
  await dialog.getByLabel("Title").fill("Cancelled activity");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("group", { name: /Cancelled activity/ })).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
  await expect(page.getByRole("group", { name: /Cancelled activity/ })).toHaveCount(0);
});

test("duplicates an activity and edits its priority", async ({ page }) => {
  const activity = page.getByRole("group", { name: /Documentation, Admin/ });
  await activity.click();
  await page.getByRole("button", { name: "Duplicate Documentation" }).click();
  await expect(page.getByRole("group", { name: /Documentation, Admin/ })).toHaveCount(2);

  const duplicate = page.getByRole("group", { name: /Documentation, Admin/ }).last();
  await duplicate.press("Enter");
  const dialog = page.getByRole("dialog").last();
  await dialog.getByText("High", { exact: true }).click();
  await dialog.getByText("Violet", { exact: true }).click();
  await expect(dialog.getByText("Saved")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.reload();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
  await page.getByRole("group", { name: /Documentation, Admin/ }).last().press("Enter");
  const reopenedDialog = page.getByRole("dialog").last();
  await expect(reopenedDialog.getByRole("radio", { name: "High" })).toBeChecked();
  await expect(reopenedDialog.getByRole("radio", { name: "Violet" })).toBeChecked();
});

test("moves an activity to another date from its action menu", async ({ page }) => {
  const activity = page.getByRole("group", { name: /Documentation, Admin/ });
  await activity.click();
  await page.getByRole("button", { name: "Move Documentation to another date" }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel("Date").fill("2026-09-17");
  await dialog.getByRole("button", { name: "Done" }).click();

  await expect(page.locator('[data-timeline-track="2026-09-17"]').getByRole("group", { name: /Documentation, Admin/ })).toBeVisible();
});

test("navigates the timeline by month and returns to today", async ({ page }) => {
  await expect(page.locator("[data-timeline-track]")).toHaveCount(30);
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByText(/August 2026/).last()).toBeVisible();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByText(/September 2026/).last()).toBeVisible();
});

test("keeps the timeline toggle temporary and the Settings toggle global", async ({ page }) => {
  await expect(page.getByRole("button", { name: /Rest days.*Shown/ })).toBeVisible();
  await page.getByRole("button", { name: /Rest days.*Shown/ }).click();
  await expect(page.getByRole("button", { name: /Rest days.*Hidden/ })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("tab", { name: /Rest days/ }).click();
  await expect(page.getByRole("button", { name: "Shown" })).toBeVisible();

  await page.getByRole("button", { name: "Shown" }).click();
  await expect(page.getByRole("button", { name: "Hidden" })).toBeVisible();

  await page.getByRole("link", { name: "Timeline" }).click();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
  await expect(page.getByText("— · Rest day", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Public holiday|Leave|Weekly holiday/)).toHaveCount(0);
  await expect(page.locator("[data-timeline-track]")).toHaveCount(1);
});

test("configures weekly holidays and marks a selected date as leave", async ({ page }) => {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("tab", { name: /Rest days/ }).click();
  await page.getByRole("checkbox", { name: "Saturday" }).check();

  await expect(page.getByText("Weekly holiday", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Public holiday", exact: true }).click();
  await expect(page.getByText("Public holiday", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.getByText("Leave", { exact: true }).first()).toBeVisible();

  await page.reload();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
  await page.getByRole("tab", { name: /Rest days/ }).click();
  await expect(page.getByRole("checkbox", { name: "Saturday" })).toBeChecked();
  await expect(page.getByText("Leave", { exact: true }).first()).toBeVisible();
});

test("scrolls today into view when the month loads", async ({ page }) => {
  const todayTrack = page.locator('[data-timeline-track="2026-09-18"]');
  const box = await todayTrack.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;

  expect(box.y).toBeLessThan(viewport.height);
  expect(box.y + box.height).toBeGreaterThan(0);
});

test("keeps the timeline toolbar and time header visible while scrolling", async ({ page }) => {
  const toolbar = page.locator("[data-timeline-toolbar='true']");
  const timeHeader = page.locator("[data-time-header='true']");

  await page.evaluate(() => window.scrollTo(0, 500));

  const toolbarBox = await toolbar.boundingBox();
  const timeHeaderBox = await timeHeader.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(timeHeaderBox).not.toBeNull();
  if (!toolbarBox || !timeHeaderBox) return;

  expect(toolbarBox.y).toBeGreaterThanOrEqual(0);
  expect(toolbarBox.y).toBeLessThanOrEqual(1);
  expect(Math.abs(timeHeaderBox.y - toolbarBox.height)).toBeLessThanOrEqual(1);
});

test("keeps the hour header aligned after the timeline auto-scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 907 });
  await page.reload();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();

  const positions = await page.evaluate(() => ({
    trackLeft: document.querySelector<HTMLElement>("[data-timeline-track]")?.getBoundingClientRect().left ?? 0,
    hoursLeft: document.querySelector<HTMLElement>("[data-time-hours]")?.getBoundingClientRect().left ?? 0,
    scrollLeft: document.querySelector<HTMLElement>("[data-timeline-scroll]")?.scrollLeft ?? 0,
  }));

  expect(positions.scrollLeft).toBeGreaterThan(0);
  expect(Math.abs(positions.trackLeft - positions.hoursLeft)).toBeLessThanOrEqual(1);
});

test("keeps hour labels on one line across the configured visible day", async ({ page }) => {
  await page.evaluate(() => {
    window.localStorage.setItem("workflow.preferences", JSON.stringify({
      startHour: "07:00",
      endHour: "22:00",
      snapMinutes: 15,
      timezone: "Asia/Kolkata",
    }));
  });
  await page.reload();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();

  const hourLabels = page.locator('[data-time-hours="true"] span');
  await expect(hourLabels).toHaveCount(15);
  for (const label of await hourLabels.all()) {
    await expect(label).toHaveCSS("white-space", "nowrap");
  }
});

test("switches between timeline, date-wise Kanban, and table views", async ({ page }) => {
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  const kanban = page.locator('[data-view="kanban"]');
  await expect(kanban).toBeVisible();
  await expect(kanban.locator('[aria-labelledby="kanban-date-2026-09-18"]')).toContainText("Documentation");

  const kanbanDates = await kanban.locator("section[aria-labelledby^='kanban-date-']").evaluateAll((columns) =>
    columns.map((column) => column.getAttribute("aria-labelledby")?.replace("kanban-date-", "")),
  );
  expect(kanbanDates[0]).toBe("2026-09-30");
  expect(kanbanDates.at(-1)).toBe("2026-09-01");

  await page.getByRole("button", { name: "Table", exact: true }).click();
  const table = page.locator('[data-view="table"]');
  await expect(table).toBeVisible();
  await expect(table.getByRole("row", { name: /Documentation/ })).toBeVisible();
  await table.getByRole("row", { name: /Documentation/ }).click();
  await expect(page.getByRole("dialog").last()).toBeVisible();
  await page.getByRole("button", { name: "Close activity details" }).click();

  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await page.reload();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
  await expect(page.locator('[data-view="kanban"]')).toBeVisible();
});

test("searches, filters, and sorts the activity table together", async ({ page }) => {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const table = page.locator('[data-view="table"]');
  const tableTools = page.getByRole("search", { name: "Search and filter activities" });
  await expect(table).toBeVisible();

  await tableTools.getByRole("searchbox", { name: "Search activities" }).fill("Documentation");
  await expect(table.getByRole("row", { name: /Documentation/ })).toHaveCount(1);
  await expect(table.getByRole("row", { name: /Timeline interaction prototype/ })).toHaveCount(0);

  await tableTools.getByRole("button", { name: /Clear table filters/ }).click();
  await tableTools.getByRole("combobox", { name: "Filter by category" }).selectOption("admin");
  await expect(table.getByRole("row", { name: /Documentation/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /Product discovery session/ })).toHaveCount(0);

  await tableTools.getByRole("button", { name: /Clear table filters/ }).click();
  await table.getByRole("button", { name: /Sort by Activity/ }).click();
  await expect(table.locator("tbody tr").first()).toContainText("Customer onboarding review");
});

test("renders overlapping activities in separate lanes and exposes derived gaps", async ({ page }) => {
  const overlappingActivity = page.getByRole("group", { name: /Customer onboarding review, Meetings/ });
  const runningActivity = page.getByRole("group", { name: /Release planning, Product/ });
  const overlapBox = await overlappingActivity.boundingBox();
  const runningBox = await runningActivity.boundingBox();
  expect(overlapBox).not.toBeNull();
  expect(runningBox).not.toBeNull();
  if (!overlapBox || !runningBox) return;

  expect(Math.abs(overlapBox.y - runningBox.y)).toBeGreaterThan(1);

  const gap = page.getByRole("button", { name: "Create activity for 10:30 AM to 10:45 AM" });
  await expect(gap).toBeVisible();
});

test("uses a compact popup for a short earlier activity beside a newly started task", async ({ page }) => {
  await page.evaluate(() => {
    const activities = [
      {
        id: "earlier-today",
        title: "Earlier today",
        startAt: "2026-09-18T07:15:00.000Z",
        endAt: "2026-09-18T07:30:00.000Z",
        categoryId: "product",
        notes: "",
        tags: [],
      },
      {
        id: "new-running",
        title: "New running task",
        startAt: "2026-09-18T08:13:00.000Z",
        endAt: null,
        categoryId: "deep-work",
        notes: "",
        tags: [],
      },
    ];
    window.localStorage.setItem("workflow.testClock", String(Date.parse("2026-09-18T08:20:00.000Z")));
    window.localStorage.setItem("workflow.showRestDays", "false");
    window.localStorage.setItem("workflow.activities", JSON.stringify({ version: 1, activities }));
  });
  const storedActivities = await page.evaluate(() => window.localStorage.getItem("workflow.activities"));
  expect(storedActivities).not.toBeNull();
  if (!storedActivities) return;
  await page.route("**/activities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: storedActivities,
    });
  });
  await page.reload();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();

  const earlier = page.getByRole("group", { name: /Earlier today, Product/ });
  const running = page.getByRole("group", { name: /New running task, Deep Work/ });
  await expect(earlier).toHaveAttribute("data-compact", "true");
  await expect(earlier.locator(":scope > span").first()).toBeHidden();
  await expect(earlier.locator(":scope > span").nth(1)).not.toHaveCSS("display", "none");
  const earlierBox = await earlier.boundingBox();
  const runningBox = await running.boundingBox();
  expect(earlierBox).not.toBeNull();
  expect(runningBox).not.toBeNull();
  if (!earlierBox || !runningBox) return;

  expect(Math.abs(earlierBox.y - runningBox.y)).toBeLessThanOrEqual(1);
  expect(earlierBox.x + earlierBox.width).toBeLessThanOrEqual(runningBox.x + 1);

  await earlier.click();
  const popup = page.getByRole("dialog", { name: "Details for Earlier today" });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("Product");
  await expect(popup).toContainText("15 minutes");
  await expect(page.getByRole("button", { name: "Delete Earlier today" })).toBeVisible();
  const closeButton = page.getByRole("button", { name: "Close details for Earlier today" });
  await expect(closeButton).toBeVisible();
  const popupBox = await popup.boundingBox();
  expect(popupBox).not.toBeNull();
  if (popupBox) {
    expect(popupBox.y).toBeLessThan(earlierBox.y);
  }
  await closeButton.click();
  await expect(popup).not.toBeVisible();

  await earlier.click();
  await expect(popup).toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(popup).not.toBeVisible();
});

test("renders one current-time marker across all timeline tracks", async ({ page }) => {
  const marker = page.locator('[data-current-time-marker="true"]');
  const timeline = page.locator('[data-timeline-scroll="true"]');
  const firstTrack = page.locator('[data-timeline-track]').first();
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute("style", /--now-position:\s*33\.333/);
  await expect(marker).toHaveAttribute("aria-label", "Current time");

  const markerBox = await marker.boundingBox();
  const timelineBox = await timeline.boundingBox();
  const firstTrackBox = await firstTrack.boundingBox();
  expect(markerBox).not.toBeNull();
  expect(timelineBox).not.toBeNull();
  expect(firstTrackBox).not.toBeNull();
  if (!markerBox || !timelineBox || !firstTrackBox) return;

  expect(Math.abs(markerBox.y - timelineBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(markerBox.height - timelineBox.height)).toBeLessThanOrEqual(1);
  expect(markerBox.height).toBeGreaterThan(firstTrackBox.height);
});

test("moves and resizes an activity with pointer interaction", async ({ page }) => {
  const activity = page.getByRole("group", { name: /Timeline interaction prototype, Deep Work/ });
  const track = page.locator('[data-timeline-track="2026-09-18"]');
  const activityBox = await activity.boundingBox();
  const trackBox = await track.boundingBox();
  expect(activityBox).not.toBeNull();
  expect(trackBox).not.toBeNull();
  if (!activityBox || !trackBox) return;

  const snapWidth = trackBox.width / 48;
  const centerY = activityBox.y + activityBox.height / 2;
  await page.mouse.move(activityBox.x + activityBox.width / 2, centerY);
  await page.mouse.down();
  await page.mouse.move(activityBox.x + activityBox.width / 2 + snapWidth * 2, centerY, { steps: 4 });
  await page.mouse.up();
  await expect(activity).toHaveAttribute("aria-label", /9:15 AM – 11:00 AM/);

  await activity.click();
  const endHandle = page.getByRole("button", { name: "Resize end of Timeline interaction prototype" });
  const handleBox = await endHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  if (!handleBox) return;

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + snapWidth, handleBox.y + handleBox.height / 2);
  await page.mouse.up();
  await expect(activity).toHaveAttribute("aria-label", /9:15 AM – 11:15 AM/);
});

test("supports keyboard movement, resize mode, and details editing", async ({ page }) => {
  const activity = page.getByRole("group", { name: /Timeline interaction prototype, Deep Work/ });
  await activity.focus();
  await activity.press("Alt+ArrowRight");
  await expect(activity).toHaveAttribute("aria-label", /9:00 AM – 10:45 AM/);

  await activity.press("Alt+Shift+ArrowRight");
  await expect(activity).toHaveAttribute("aria-label", /9:00 AM – 11:00 AM/);

  await activity.press("r");
  const startHandle = page.getByRole("button", { name: "Resize start of Timeline interaction prototype" });
  await expect(startHandle).toBeFocused();
  await startHandle.press("ArrowLeft");
  await expect(activity).toHaveAttribute("aria-label", /8:45 AM – 11:00 AM/);

  await activity.press("Escape");
  await activity.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const title = page.getByLabel("Title");
  await title.fill("Renamed interaction");
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: "Close activity details" }).click();
  await expect(page.getByRole("group", { name: /Renamed interaction, Deep Work/ })).toBeVisible();
});

test("persists a renamed activity through reload", async ({ page }) => {
  const activity = page.getByRole("group", { name: /Documentation, Admin/ });
  await activity.press("Enter");
  await page.getByLabel("Title").fill("Documentation follow-up");
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("group", { name: /Documentation follow-up, Admin/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("group", { name: /Documentation follow-up, Admin/ })).toBeVisible();
});

test("deletes an activity and restores it with the Undo action", async ({ page }) => {
  const activity = page.getByRole("group", { name: /Documentation, Admin/ });
  await activity.click();
  await page.getByRole("button", { name: "Delete Documentation" }).click();
  await expect(page.getByRole("group", { name: /Documentation, Admin/ })).toHaveCount(0);

  await page.getByRole("alert").getByRole("button", { name: "Undo" }).click();
  const restored = page.getByRole("group", { name: /Documentation, Admin/ });
  await expect(restored).toBeVisible();
  await expect(restored).toBeFocused();
});

test("undoes a committed detail edit with the keyboard shortcut", async ({ page }) => {
  const activity = page.getByRole("group", { name: /Documentation, Admin/ });
  await activity.press("Enter");
  await page.getByLabel("Title").fill("Documentation follow-up");
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("group", { name: /Documentation follow-up, Admin/ })).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect(page.getByRole("group", { name: /Documentation, Admin/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /Documentation follow-up, Admin/ })).toHaveCount(0);
});

test("switches themes and persists the selected theme", async ({ page }) => {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("selects and persists an accent palette theme", async ({ page }) => {
  await page.getByTitle("Timeline appearance").click();
  const palette = page.getByRole("group", { name: "Accent theme" });
  await expect(palette).toBeVisible();
  await palette.getByRole("button", { name: "Red theme" }).click();

  const readAccent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim());
  expect(await readAccent()).toBe("#db3136");
  await page.reload();
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
  expect(await readAccent()).toBe("#db3136");
  await page.getByTitle("Timeline appearance").click();
  await expect(page.getByRole("button", { name: "Red theme" })).toHaveAttribute("aria-pressed", "true");
});

test("recovers a running activity that crossed midnight while closed", async ({ page }) => {
  await page.evaluate(() => {
    window.localStorage.setItem("workflow.activities", JSON.stringify({
      version: 1,
      activities: [{
        id: "stale-timer",
        title: "Stale timer",
        startAt: "2026-09-17T23:30:00+05:30",
        endAt: null,
        categoryId: "deep-work",
        notes: "",
        tags: [],
      }],
    }));
  });
  await page.reload();

  const recoveryDialog = page.getByRole("dialog");
  await expect(recoveryDialog).toContainText("Stale timer");
  await recoveryDialog.getByRole("button", { name: "Stop at midnight" }).click();
  await expect(recoveryDialog).not.toBeVisible();

  const endAt = await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem("workflow.activities") ?? "{}") as {
      activities?: Array<{ id: string; endAt: string | null }>;
    };
    return stored.activities?.find((activity) => activity.id === "stale-timer")?.endAt;
  });
  expect(endAt).toBe("2026-09-17T18:30:00.000Z");
});
