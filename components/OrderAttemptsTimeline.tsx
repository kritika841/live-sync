"use client";

import React, { useEffect, useState } from "react";
import { Truck, AlertTriangle, CheckCircle2, RotateCcw, MapPin, Clock, Calendar, ArrowRight, ShieldAlert, Loader2 } from "lucide-react";
import type { DeliveryAttemptRecord } from "../lib/ndr-attempts";

export interface OrderAttemptsTimelineProps {
  orderId?: number | string;
  channelOrderId?: string;
  awb?: string;
  initialAttempts?: DeliveryAttemptRecord[];
}

function formatTime(isoOrStr?: string): string {
  if (!isoOrStr) return "—";
  try {
    const d = new Date(isoOrStr);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
    }
  } catch {}
  return isoOrStr.slice(11, 16) || isoOrStr;
}

function formatDate(isoOrStr?: string): string {
  if (!isoOrStr) return "—";
  try {
    const d = new Date(isoOrStr);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
    }
  } catch {}
  return isoOrStr.slice(0, 10);
}

export function OrderAttemptsTimeline({
  orderId,
  channelOrderId,
  awb,
  initialAttempts,
}: OrderAttemptsTimelineProps) {
  const [attempts, setAttempts] = useState<DeliveryAttemptRecord[]>(initialAttempts || []);
  const [loading, setLoading] = useState<boolean>(!initialAttempts || initialAttempts.length === 0);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (initialAttempts && initialAttempts.length > 0) {
      setAttempts(initialAttempts);
      setLoading(false);
      return;
    }

    if (!orderId && !channelOrderId && !awb) return;

    let isMounted = true;
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (orderId) params.set("id", String(orderId));
    if (channelOrderId) params.set("channel_order_id", channelOrderId);
    if (awb) params.set("awb", awb);

    fetch(`/api/orders/attempts?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load attempt history");
        return res.json();
      })
      .then((data) => {
        if (isMounted) {
          setAttempts(data.attempts || []);
        }
      })
      .catch((err) => {
        if (isMounted) setError(err instanceof Error ? err.message : "Error loading attempts");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [orderId, channelOrderId, awb, initialAttempts]);

  if (loading) {
    return (
      <div className="p-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 size={16} className="animate-spin text-primary" />
        <span>Loading attempt-by-attempt NDR history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
        {error}
      </div>
    );
  }

  if (attempts.length === 0) {
    return (
      <div className="p-5 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl">
        No delivery attempt records found yet for this shipment.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
          <Truck size={14} className="text-primary" />
          <span>Delivery Attempts & NDR Reasons History ({attempts.length})</span>
        </h4>
        <span className="text-[11px] text-muted-foreground font-mono">
          {attempts.filter((a) => a.status === "UNDELIVERED").length} NDRs encountered
        </span>
      </div>

      <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
        {attempts.map((att) => {
          const isUndelivered = att.status === "UNDELIVERED";
          const isDelivered = att.status === "DELIVERED";
          const isOfd = att.status === "OUT FOR DELIVERY";

          const dotColor = isDelivered
            ? "bg-emerald-500 ring-4 ring-emerald-500/20"
            : isUndelivered
            ? "bg-rose-500 ring-4 ring-rose-500/20"
            : "bg-sky-500 ring-4 ring-sky-500/20";

          const badgeBg = isDelivered
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
            : isUndelivered
            ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30"
            : "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30";

          return (
            <div key={att.attemptNumber} className="relative group">
              {/* Timeline marker node */}
              <div className={`absolute -left-6 top-1.5 size-3 rounded-full ${dotColor} transition-transform group-hover:scale-125`} />

              <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs space-y-2.5 hover:border-primary/40 transition">
                {/* Attempt header */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-muted text-foreground">
                      Attempt {att.attemptNumber}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${badgeBg}`}>
                      {isDelivered && <CheckCircle2 size={11} />}
                      {isUndelivered && <AlertTriangle size={11} />}
                      {isOfd && <Truck size={11} />}
                      <span>{att.status}</span>
                    </span>
                  </div>

                  <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
                    <Calendar size={12} />
                    {formatDate(att.date || att.ofdTime || att.failedAt)}
                  </span>
                </div>

                {/* Timestamps row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] bg-muted/20 rounded-lg p-2 border border-border/50">
                  {att.ofdTime && (
                    <div>
                      <span className="text-muted-foreground block text-[10px]">OFD Dispatched:</span>
                      <strong className="text-foreground">{formatTime(att.ofdTime)}</strong>
                    </div>
                  )}
                  {att.failedAt && (
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Attempt Failed:</span>
                      <strong className="text-destructive">{formatTime(att.failedAt)}</strong>
                    </div>
                  )}
                  {att.deliveredAt && (
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Delivered At:</span>
                      <strong className="text-emerald-600 dark:text-emerald-400">{formatTime(att.deliveredAt)}</strong>
                    </div>
                  )}
                  {att.location && (
                    <div className="col-span-2 sm:col-span-1">
                      <span className="text-muted-foreground block text-[10px]">Hub / Location:</span>
                      <span className="text-foreground truncate block font-medium" title={att.location}>
                        {att.location}
                      </span>
                    </div>
                  )}
                </div>

                {/* Clear NDR Reason Card */}
                {isUndelivered && att.reason && (
                  <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-2.5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 flex items-center gap-1">
                        <ShieldAlert size={12} />
                        <span>NDR Reason for Attempt {att.attemptNumber}</span>
                      </span>
                      {att.reasonCode && (
                        <span className="font-mono text-[10px] bg-rose-500/20 text-rose-800 dark:text-rose-300 px-1.5 py-0.2 rounded font-semibold">
                          {att.reasonCode}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-bold text-foreground">
                      {att.reason}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
