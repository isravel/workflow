"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import type { ActivitySaveResult } from "@/repositories/activityRepository";

export function PwaClient() {
  const [offline, setOffline] = useState<boolean | null>(null);
  const [localOnly, setLocalOnly] = useState(false);

  useEffect(() => {
    const updateConnection = () => setOffline(!window.navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);

    const updatePersistence = (event: Event) => {
      const result = (event as CustomEvent<ActivitySaveResult>).detail;
      setLocalOnly(result?.saved === true && result.storage === "local" && Boolean(result.remoteError));
    };
    window.addEventListener("workflow-persistence-status", updatePersistence);

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // PWA support is progressive; the journal still works without a service worker.
      });
    }

    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      window.removeEventListener("workflow-persistence-status", updatePersistence);
    };
  }, []);

  if (offline !== true && !localOnly) return null;

  return (
    <div className={"pwa-status"} aria-label="Connection status" aria-live="polite">
      <WifiOff size={14} aria-hidden="true" />
      <span>{offline === true ? "Offline — changes save on this device." : "Saved on this device — remote sync is unavailable."}</span>
    </div>
  );
}
