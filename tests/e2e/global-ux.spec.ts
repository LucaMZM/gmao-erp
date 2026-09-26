import { expect, test, type Page } from "@playwright/test";

const runtimeErrors = new WeakMap<Page, string[]>();

async function waitForApp(page: Page) {
  await page.locator('.app-frame[data-hydrated="true"]').waitFor();
}

async function waitForFacets(page: Page) {
  await page.locator('.faceted-filter-shell[data-hydrated="true"]').waitFor();
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const response = await page.request.post("/api/auth/login", {
    data: { email: "responsable@mazmi.demo", password: "Mazmi2026!" },
  });
  expect(response.ok()).toBeTruthy();
  const token = /mazmi_session=([^;]+)/.exec(
    response.headers()["set-cookie"] ?? "",
  )?.[1];
  expect(token).toBeTruthy();
  await page.context().addCookies([
    {
      name: "mazmi_session",
      value: token!,
      url: new URL(response.url()).origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});

test.afterEach(async ({ page }) => {
  expect(
    runtimeErrors.get(page),
    "Browser console/runtime must remain clean",
  ).toEqual([]);
});

test("asset hierarchy expands without navigating and exposes matching descendants", async ({
  page,
}) => {
  await page.goto("/assets?view=hierarchy");
  await waitForApp(page);
  await page.locator('.table-scroll[data-hydrated="true"]').waitFor();
  await expect(page.getByRole("heading", { name: "Activos" })).toBeVisible();
  const firstExpandableRow = page
    .locator(".asset-table tbody tr")
    .filter({ has: page.getByRole("button", { name: /^Expandir / }) })
    .first();
  const expand = firstExpandableRow.getByRole("button");
  await expect(expand).toBeVisible();
  const identity = (await expand.getAttribute("aria-label"))?.replace(
    /^Expandir /,
    "",
  );
  expect(identity).toBeTruthy();
  const before = await page.locator(".asset-table tbody tr").count();
  const url = page.url();
  await expand.click();
  const openButton = page.getByRole("button", {
    name: `Contraer ${identity}`,
    exact: true,
  });
  await expect(openButton).toHaveAttribute("aria-expanded", "true");
  expect(page.url()).toBe(url);
  const expandedCount = await page.locator(".asset-table tbody tr").count();
  expect(expandedCount).toBeGreaterThan(before);
  const componentLink = openButton
    .locator("xpath=ancestor::tr")
    .locator("xpath=following-sibling::tr")
    .first()
    .locator('a[href^="/assets/"]');
  await expect(componentLink).toBeVisible();
  await expect(
    componentLink.locator("xpath=ancestor::tr").locator(".asset-expand-button"),
  ).toHaveCount(0);

  await openButton.click();
  await expect(page.locator(".asset-table tbody tr")).toHaveCount(before);
  expect(page.url()).toBe(url);

  await page
    .getByRole("button", { name: `Expandir ${identity}`, exact: true })
    .click();
  const parentLink = page
    .getByRole("button", { name: `Contraer ${identity}`, exact: true })
    .locator("xpath=ancestor::tr")
    .locator('a[href^="/assets/"]');
  const parentHref = await parentLink.getAttribute("href");
  expect(parentHref).toMatch(/^\/assets\//);
  await parentLink.click();
  await expect(page).toHaveURL(new RegExp(`${parentHref}$`));
  await expect(page.locator(".component-tree")).toBeVisible();

  await page.goto("/assets?view=hierarchy&q=LM-02-APP");
  await waitForApp(page);
  await expect(page.getByText("LM-02-APP", { exact: true })).toBeVisible();
  await expect(page.getByText("LM-02", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Contraer LM-02 / }),
  ).toHaveAttribute("aria-expanded", "true");
  const assetHrefs = await page
    .locator('.asset-table a[href^="/assets/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(new Set(assetHrefs).size).toBe(assetHrefs.length);
});

test("asset facets exclude their own selection and keep URL navigation coherent", async ({
  page,
}) => {
  await page.goto("/assets?view=list");
  await waitForFacets(page);
  await page.locator('select[name="area"]').selectOption("LAM");
  await expect(page).toHaveURL(/area=LAM/);
  const statusValues = await page
    .locator('select[name="status"] option')
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  expect(statusValues).toContain("DEGRADED");
  expect(statusValues).toContain("OPERATING");

  await page.locator('select[name="status"]').selectOption("DEGRADED");
  await expect(page).toHaveURL(/status=DEGRADED/);
  const criticality = page.locator('select[name="criticality"]');
  const firstCriticality = await criticality
    .locator('option:not([value=""])')
    .first()
    .getAttribute("value");
  expect(firstCriticality).toBeTruthy();
  await criticality.selectOption(firstCriticality!);
  await expect(page).toHaveURL(/criticality=/);

  await page.goBack();
  await waitForFacets(page);
  await expect(page).toHaveURL(/status=DEGRADED/);
  await expect(page).not.toHaveURL(/criticality=/);
  await page.goForward();
  await expect(page).toHaveURL(/criticality=/);
  await page.reload();
  await waitForFacets(page);
  await expect(page.locator('select[name="criticality"]')).not.toHaveValue("");

  await page.getByRole("button", { name: /^Quitar filtro Estado:/ }).click();
  await expect(page).not.toHaveURL(/status=/);
  await page.getByRole("button", { name: "Limpiar todos" }).click();
  await expect(page).toHaveURL(/view=list$/);

  const next = page.getByRole("link", { name: "Siguiente" });
  await expect(next).not.toHaveAttribute("aria-disabled", "true");
  await next.click();
  await expect(page).toHaveURL(/page=2/);
  await waitForFacets(page);
  await page.locator('select[name="status"]').selectOption("OPERATING");
  await expect(page).toHaveURL(/status=OPERATING/);
  await expect(page).not.toHaveURL(/page=2/);
  await waitForFacets(page);
  await page.locator('input[name="q"]').fill("LM");
  await page.getByRole("button", { name: /Aplicar/ }).click();
  await expect(page).toHaveURL(/q=LM/);
  await expect(page).not.toHaveURL(/page=2/);

  await waitForFacets(page);
  await page.locator('input[name="q"]').fill("__NO_ASSET__");
  await page.getByRole("button", { name: /Aplicar/ }).click();
  await expect(page.locator(".empty-state strong")).toHaveText(
    "Sin resultados",
  );
});

test("global and listing search controls are platform neutral", async ({
  page,
}) => {
  await page.goto("/work-orders?view=all");
  await waitForApp(page);
  await waitForFacets(page);
  await expect(
    page.getByRole("button", { name: "Buscar en Mazmi" }),
  ).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/⌘|\bCmd\b/i);
  await page.getByRole("button", { name: "Buscar en Mazmi" }).click();
  await expect(
    page.getByRole("dialog", { name: "Búsqueda global" }),
  ).toBeVisible();
  await expect(page.getByText("Búsqueda rápida")).toBeVisible();

  await page.keyboard.press("Escape");
  await page.locator('select[name="type"]').selectOption("CORRECTIVE");
  await expect(page).toHaveURL(/type=CORRECTIVE/);
  await waitForFacets(page);
  const priorities = await page
    .locator('select[name="priority"] option')
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  expect(priorities.length).toBeGreaterThan(1);
});

test("remaining server-backed list facets update without impossible options", async ({
  page,
}) => {
  for (const route of [
    "/inventory",
    "/incidents?view=all",
    "/maintenance-plans",
    "/audit",
  ]) {
    await page.goto(route);
    await waitForFacets(page);
    const selects = page.locator(".faceted-filter-shell select");
    for (let index = 0; index < (await selects.count()); index += 1) {
      const values = await selects
        .nth(index)
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        );
      expect(new Set(values).size).toBe(values.length);
    }
  }
});
