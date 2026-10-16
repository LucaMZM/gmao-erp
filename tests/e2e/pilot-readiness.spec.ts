import { expect, test, type Page } from "@playwright/test";

async function loginAdmin(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { email: "admin@mazmi.demo", password: "Mazmi2026!" },
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
}

test("pilot administration and reporting remain usable without console errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await loginAdmin(page);
  for (const [route, heading] of [
    ["/assets/manage", "Administrar activos"],
    ["/inventory/manage", "Administrar recambios"],
    ["/governance/users", "Usuarios y acceso"],
    ["/governance/rates", "Tarifas de mano de obra"],
    ["/imports", "Import Center"],
    ["/reports", "Reporting Center"],
  ]) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: heading, level: 1 }),
    ).toBeVisible();
    await page.locator('.app-frame[data-hydrated="true"]').waitFor();
    if (route === "/inventory/manage")
      await expect(
        page.getByRole("heading", { name: "Primer conteo en una ubicación" }),
      ).toBeVisible();
    if (route === "/reports") {
      await page.getByText("Cómo se calculan estos indicadores").click();
      await expect(page.getByText(/MTBF/).first()).toBeVisible();
      const toggle = page.getByRole("button", { name: "Cambiar tema" });
      await toggle.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    }
  }
  expect(errors).toEqual([]);
});
