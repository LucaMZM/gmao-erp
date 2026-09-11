import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "@playwright/test";
import { build } from "esbuild";

let browser: Browser;
let clientScript: string;
beforeAll(async () => {
  browser = await chromium.launch();
  clientScript = (
    await build({
      entryPoints: ["lib/client/offline-queue.ts"],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "OfflineAudit",
      platform: "browser",
    })
  ).outputFiles[0].text;
});

it("offline retry keeps original key, payload and author after explicit permission denial", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests: Array<{
    headers: Record<string, string>;
    body: string | null;
  }> = [];
  await page.route("https://offline-audit.invalid/**", async (route) => {
    if (route.request().method() === "POST") {
      requests.push({
        headers: route.request().headers(),
        body: route.request().postData(),
      });
      await route.fulfill(
        requests.length === 1
          ? { status: 403, json: { error: { message: "Scope revocado" } } }
          : { status: 200, json: { data: { ok: true }, replayed: true } },
      );
    } else
      await route.fulfill({
        contentType: "text/html",
        body: '<div data-offline-user="user-a" data-offline-site="site-levante" data-offline-org="org-a"></div>',
      });
  });
  try {
    await page.goto("https://offline-audit.invalid/");
    await page.addScriptTag({ content: clientScript });
    await page.evaluate(async () => {
      const api = (
        window as unknown as {
          OfflineAudit: typeof import("@/lib/client/offline-queue");
        }
      ).OfflineAudit;
      await api.enqueueOfflineOperation("/api/field/handovers", {
        summary: "Retry original",
      });
      await api.syncOfflineQueue();
    });
    const failed = await page.evaluate(async () =>
      (
        window as unknown as {
          OfflineAudit: typeof import("@/lib/client/offline-queue");
        }
      ).OfflineAudit.listOfflineOperations(),
    );
    expect(failed[0].state).toBe("FAILED");
    expect(failed[0].lastError).toBe("Scope revocado");
    await page.evaluate(async () => {
      const api = (
        window as unknown as {
          OfflineAudit: typeof import("@/lib/client/offline-queue");
        }
      ).OfflineAudit;
      await Promise.all([api.syncOfflineQueue(), api.syncOfflineQueue()]);
    });
    expect(requests).toHaveLength(2);
    expect(requests[0].body).toBe(requests[1].body);
    for (const header of [
      "idempotency-key",
      "x-mazmi-user",
      "x-mazmi-site",
      "x-mazmi-organization",
    ])
      expect(requests[0].headers[header]).toBe(requests[1].headers[header]);
    expect(requests[0].headers["idempotency-key"]).toBe(failed[0].key);
  } finally {
    await context.close();
  }
});
afterAll(async () => {
  await browser?.close();
});

it.each([
  ["legacy record without owner", false, "user-a", false],
  ["interrupted sync with original owner", true, "user-a", true],
  ["interrupted sync after account switch", true, "user-b", false],
] as const)(
  "offline durable recovery: %s",
  async (_label, hasOwner, currentUser, allowed) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const keys: string[] = [];
    await page.route("https://offline-audit.invalid/**", async (route) => {
      if (route.request().method() === "POST") {
        keys.push(route.request().headers()["idempotency-key"]);
        await route.fulfill({ json: { data: { ok: true }, replayed: true } });
      } else
        await route.fulfill({
          contentType: "text/html",
          body: `<div data-offline-user="${currentUser}" data-offline-site="site-levante" data-offline-org="org-a"></div>`,
        });
    });
    try {
      await page.goto("https://offline-audit.invalid/");
      await page.addScriptTag({ content: clientScript });
      const rows = await page.evaluate(async (hasOwner) => {
        const api = (
          window as unknown as {
            OfflineAudit: typeof import("@/lib/client/offline-queue");
          }
        ).OfflineAudit;
        await api.listOfflineOperations();
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("mazmi-field-operations", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("operations", "readwrite");
            tx.objectStore("operations").put({
              key: "field_interrupted_audit",
              path: "/api/field/handovers",
              body: { summary: "Original persisted payload" },
              state: "SYNCING",
              attempts: 1,
              createdAt: "2026-08-20T08:00:00Z",
              lastError: null,
              ...(hasOwner
                ? {
                    scope: {
                      userId: "user-a",
                      siteId: "site-levante",
                      organizationId: "org-a",
                    },
                  }
                : {}),
            });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
        });
        await api.syncOfflineQueue();
        return api.listOfflineOperations();
      }, hasOwner);
      expect(keys).toEqual(allowed ? ["field_interrupted_audit"] : []);
      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe(allowed ? "SYNCED" : "SYNCING");
      expect(rows[0].body).toEqual({ summary: "Original persisted payload" });
    } finally {
      await context.close();
    }
  },
);

it.each([
  ["same user/site", "user-a", "site-levante", "org-a", true],
  ["same user/other site", "user-a", "site-alzira", "org-a", false],
  ["other user/same site", "user-b", "site-levante", "org-a", false],
  ["other user/other site", "user-b", "site-alzira", "org-a", false],
  ["other organization", "user-a", "site-levante", "org-b", false],
] as const)(
  "offline ownership: %s",
  async (_label, userId, siteId, organizationId, allowed) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const posts: string[] = [];
    await page.route("https://offline-audit.invalid/**", async (route) => {
      if (route.request().method() === "POST") {
        posts.push(route.request().url());
        await route.fulfill({ json: { data: { ok: true } } });
      } else
        await route.fulfill({
          contentType: "text/html",
          body: '<div data-offline-user="user-a" data-offline-site="site-levante" data-offline-org="org-a"></div>',
        });
    });
    try {
      await page.goto("https://offline-audit.invalid/");
      await page.addScriptTag({ content: clientScript });
      await page.evaluate(
        async ({ userId, siteId, organizationId }) => {
          const api = (
            window as unknown as {
              OfflineAudit: {
                enqueueOfflineOperation: (
                  p: string,
                  b: Record<string, unknown>,
                ) => Promise<unknown>;
              };
            }
          ).OfflineAudit;
          await api.enqueueOfflineOperation("/api/field/handovers", {
            fromShift: "Mañana",
            toShift: "Tarde",
            summary: "Relevo confidencial de Levante",
            workOrderNumbers: [],
          });
          const element = document.querySelector<HTMLElement>(
            "[data-offline-user]",
          )!;
          element.dataset.offlineUser = userId;
          element.dataset.offlineSite = siteId;
          element.dataset.offlineOrg = organizationId;
        },
        { userId, siteId, organizationId },
      );
      await page.evaluate(async () => {
        await (
          window as unknown as {
            OfflineAudit: { syncOfflineQueue: () => Promise<void> };
          }
        ).OfflineAudit.syncOfflineQueue();
      });
      expect(posts).toHaveLength(allowed ? 1 : 0);
      const rows = await page.evaluate(
        async () =>
          await (
            window as unknown as {
              OfflineAudit: {
                listOfflineOperations: () => Promise<Array<{ state: string }>>;
              };
            }
          ).OfflineAudit.listOfflineOperations(),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe(allowed ? "SYNCED" : "PENDING");
    } finally {
      await context.close();
    }
  },
);
