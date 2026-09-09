"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  listOfflineOperations,
  offlineQueueChangeEvent,
  syncOfflineQueue,
} from "@/lib/client/offline-queue";

export function OfflineQueueStatus() {
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);
  const refresh = useCallback(async () => {
    const items = await listOfflineOperations();
    setPending(items.filter((item) => item.state === "PENDING").length);
    setFailed(items.filter((item) => item.state === "FAILED").length);
  }, []);
  const sync = useCallback(async () => {
    setSyncing(true);
    await syncOfflineQueue();
    await refresh();
    setSyncing(false);
  }, [refresh]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const onChange = () => void refresh();
    const onOnline = () => void sync();
    const onConnectivity = () => setOnline(navigator.onLine);
    window.addEventListener(offlineQueueChangeEvent, onChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("online", onConnectivity);
    window.addEventListener("offline", onConnectivity);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener(offlineQueueChangeEvent, onChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("online", onConnectivity);
      window.removeEventListener("offline", onConnectivity);
    };
  }, [refresh, sync]);

  if (!pending && !failed && !syncing) return null;
  return (
    <div className="offline-queue-status" role="status">
      <CloudOff size={14} />
      <span>
        {syncing
          ? "Sincronizando operaciones…"
          : `${pending} pendiente${pending === 1 ? "" : "s"}${failed ? ` · ${failed} con error` : ""}`}
      </span>
      <button
        disabled={syncing || !online}
        onClick={() => void sync()}
        type="button"
      >
        <RefreshCw size={13} /> Reintentar
      </button>
    </div>
  );
}
