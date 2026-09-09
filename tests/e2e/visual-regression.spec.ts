import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string) {
  const response = await page.request.post("/api/auth/login", {
    data: { email, password: "Mazmi2026!" },
  });
  expect(response.ok()).toBeTruthy();
  const setCookie = response.headers()["set-cookie"] ?? "";
  const token = /mazmi_session=([^;]+)/.exec(setCookie)?.[1];
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
  await page.goto(email.startsWith("tecnico") ? "/my-work" : "/overview");
}

test("login is visually stable", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bienvenido a planta." }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot(`login-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});

test("enterprise decision surfaces are visually stable", async ({
  page,
}, testInfo) => {
  await login(page, "responsable@mazmi.demo");
  for (const [name, route, heading] of [
    ["overview", "/overview", "Centro de Control"],
    ["planner", "/planner?week=2026-09-07", "Planner de mantenimiento"],
    ["reliability", "/reliability", "Reliability Center"],
    ["procurement", "/procurement", "Procurement"],
    ["reporting", "/reports", "Reporting Center"],
    ["governance", "/governance", "Gobierno operativo"],
  ] as const) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: heading }).first(),
    ).toBeVisible();
    await expect(page).toHaveScreenshot(
      `${name}-${testInfo.project.name}.png`,
      {
        fullPage: true,
      },
    );
  }
});

test("technician work surface is visually stable", async ({
  page,
}, testInfo) => {
  await login(page, "tecnico4@mazmi.demo");
  await expect(
    page.getByRole("heading", { name: /Buenos días/ }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot(`my-work-${testInfo.project.name}.png`, {
    fullPage: true,
  });
});

test("light theme and keyboard focus are stable", async ({
  page,
}, testInfo) => {
  await login(page, "responsable@mazmi.demo");
  const themeToggle = page.getByRole("button", { name: "Cambiar tema" });
  await page.waitForTimeout(750);
  await themeToggle.focus();
  await expect(themeToggle).toBeFocused();
  await themeToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page).toHaveScreenshot(
    `overview-light-${testInfo.project.name}.png`,
    { fullPage: true },
  );
});

test("enterprise routes keep semantic landmarks and labeled controls", async ({
  page,
}) => {
  await login(page, "responsable@mazmi.demo");
  for (const route of [
    "/overview",
    "/planner?week=2026-09-07",
    "/reliability",
    "/procurement",
    "/reports",
    "/audit",
    "/governance",
  ]) {
    await page.goto(route);
    await expect(page.locator("main#main-content")).toBeVisible();
    expect(
      await page
        .locator(
          'nav[aria-label="Navegación principal"], nav[aria-label="Navegación móvil"]',
        )
        .count(),
    ).toBeGreaterThan(0);
    const unlabeled = await page
      .locator("input, select, textarea")
      .evaluateAll((controls) =>
        controls
          .filter((control) => {
            const element = control as HTMLInputElement;
            if (element.type === "hidden") return false;
            if (element.getAttribute("aria-label")) return false;
            if (element.getAttribute("aria-labelledby")) return false;
            if (element.closest("label")) return false;
            if (
              element.id &&
              document.querySelector(`label[for="${element.id}"]`)
            )
              return false;
            return true;
          })
          .map((control) => control.outerHTML.slice(0, 180)),
      );
    expect(unlabeled, `${route} has unlabeled form controls`).toEqual([]);
  }
});
