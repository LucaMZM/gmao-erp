"use client";

export type OfflineQueueState = "PENDING" | "SYNCING" | "SYNCED" | "FAILED";

export type OfflineOperation = {
  key: string;
  path: string;
  body: Record<string, unknown>;
  state: OfflineQueueState;
  attempts: number;
  createdAt: string;
  lastError: string | null;
};

const DB_NAME = "mazmi-field-operations";
const STORE = "operations";
const EVENT = "mazmi-offline-queue-change";

export function isOfflineOperationSupported(
  path: string,
  body: Record<string, unknown>,
): boolean {
  if (path === "/api/incidents" || path === "/api/field/handovers") return true;
  if (/\/checklist$/.test(path) || /\/measurements$/.test(path)) return true;
  return /\/evidence$/.test(path) && body.kind === "NOTE";
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function notify() {
  window.dispatchEvent(new Event(EVENT));
}

export async function listOfflineOperations(): Promise<OfflineOperation[]> {
  return transaction("readonly", (store) => store.getAll());
}

async function save(operation: OfflineOperation) {
  await transaction("readwrite", (store) => store.put(operation));
  notify();
}

export async function enqueueOfflineOperation(
  path: string,
  body: Record<string, unknown>,
): Promise<OfflineOperation> {
  const operation: OfflineOperation = {
    key: `field_${crypto.randomUUID()}`,
    path,
    body,
    state: "PENDING",
    attempts: 0,
    createdAt: new Date().toISOString(),
    lastError: null,
  };
  await save(operation);
  return operation;
}

export async function postWithOfflineQueue(
  path: string,
  body: Record<string, unknown>,
): Promise<{ queued: boolean; response?: Response }> {
  if (!navigator.onLine) {
    await enqueueOfflineOperation(path, body);
    return { queued: true };
  }
  const key = `field_${crypto.randomUUID()}`;
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
    return { queued: false, response };
  } catch {
    await save({
      key,
      path,
      body,
      state: "PENDING",
      attempts: 0,
      createdAt: new Date().toISOString(),
      lastError: null,
    });
    return { queued: true };
  }
}

export async function syncOfflineQueue(): Promise<void> {
  if (!navigator.onLine) return;
  const operations = (await listOfflineOperations()).filter((item) =>
    ["PENDING", "FAILED"].includes(item.state),
  );
  for (const operation of operations) {
    await save({ ...operation, state: "SYNCING" });
    try {
      const response = await fetch(operation.path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": operation.key,
        },
        body: JSON.stringify(operation.body),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        await save({
          ...operation,
          state: "FAILED",
          attempts: operation.attempts + 1,
          lastError: payload.error?.message ?? `HTTP ${response.status}`,
        });
        continue;
      }
      await save({
        ...operation,
        state: "SYNCED",
        attempts: operation.attempts + 1,
        lastError: null,
      });
    } catch {
      await save({
        ...operation,
        state: "FAILED",
        attempts: operation.attempts + 1,
        lastError: "Conectividad no disponible",
      });
      break;
    }
  }
}

export const offlineQueueChangeEvent = EVENT;
