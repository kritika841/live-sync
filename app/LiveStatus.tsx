"use client";

import { useEffect, useState } from "react";
import { readJson } from "../lib/http";

type Status = { state: string; lastSyncAt?: string; lastEventAt?: string; pending?: number };

export default function LiveStatus({ preview = false }: { preview?: boolean }) {
  const [status, setStatus] = useState<Status>({ state: preview ? "offline" : "checking" });

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    async function poll() {
      try {
        const nextStatus = await readJson<Status>(
          await fetch("/api/health/sync", { cache: "no-store", signal: controller.signal })
        );
        setStatus(nextStatus);
        if (nextStatus.state === "stale") {
          fetch("/api/cron/fast-sync", {
            cache: "no-store",
            headers: { "x-requested-with": "satmi-orders-dashboard" },
          }).catch(() => null);
        }
      } catch {
        if (!controller.signal.aborted) setStatus({ state: "offline" });
      }
    }
    void poll();
    const id = setInterval(poll, 15000);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [preview]);

  const label =
    {
      healthy: "Up to date",
      syncing: "Syncing",
      stale: "Sync delayed",
      offline: "Offline",
      checking: "Connecting",
    }[status.state] || "Sync delayed";

  const dotColor =
    {
      healthy: "bg-success shadow-[0_0_8px_rgba(25,138,83,0.5)]",
      syncing: "bg-primary animate-pulse",
      stale: "bg-warning",
      offline: "bg-muted-foreground",
      checking: "bg-primary/50 animate-pulse",
    }[status.state] || "bg-warning";

  return (
    <span
      className={`global-live-status ${status.state} inline-flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors`}
      role="status"
      title={`Last sync: ${
        status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString("en-IN") : "Unavailable"
      }${status.pending ? ` · ${status.pending} pending events` : ""}`}
    >
      <span className={`inline-block size-2 rounded-full ${dotColor}`} />
      <span>{label}</span>
    </span>
  );
}
