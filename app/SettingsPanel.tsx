"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  HelpCircle,
  Save,
  Sliders,
  RefreshCw,
  Radio,
  ShieldCheck,
  Server,
  AlertCircle,
  User,
  PhoneCall,
  LayoutGrid,
  Table,
  CheckCircle2,
  Lock,
  Clock,
  ShoppingCart,
} from "lucide-react";

interface SettingsPanelProps {
  active: boolean;
  isAdmin: boolean;
  userRole?: string;
  userLabel?: string;
  userEmail?: string;
  initialDays?: number;
  onSaved?: (newDays: number) => void;
}

const PRESET_OPTIONS = [
  { days: 7, label: "7 Days", desc: "1 week lookback" },
  { days: 14, label: "14 Days", desc: "2 weeks lookback" },
  { days: 30, label: "30 Days", desc: "Standard (Recommended)" },
  { days: 60, label: "60 Days", desc: "2 months extended" },
  { days: 90, label: "90 Days", desc: "Quarterly archive" },
];

const CALLBACK_PRESETS = [
  { hours: 1, label: "1 Hour", desc: "60 min retry" },
  { hours: 2, label: "2 Hours", desc: "Short follow-up" },
  { hours: 4, label: "4 Hours", desc: "Same-day shift" },
  { hours: 6, label: "6 Hours", desc: "Half-day retry" },
  { hours: 12, label: "12 Hours", desc: "Next shift" },
  { hours: 24, label: "24 Hours", desc: "Next day (Default)" },
  { hours: 48, label: "48 Hours", desc: "2 days retry" },
];

const TRIGGER_EVENTS = [
  { name: "Order Shipped", desc: "Carrier dispatch confirmation" },
  { name: "Out For Delivery", desc: "First and latest daily OFD runs" },
  { name: "Order Delivered", desc: "Customer handover & proof" },
  { name: "NDR / Undelivered", desc: "Failed delivery attempts & reason" },
  { name: "Order Cancelled", desc: "Carrier or merchant cancellation" },
  { name: "AWB Assigned", desc: "Tracking barcode and courier binding" },
];

function formatDurationLabel(hours: number): string {
  if (hours < 1) {
    return `${Math.round(hours * 60)} Mins`;
  }
  if (Number.isInteger(hours)) {
    return `${hours} ${hours === 1 ? "Hour" : "Hours"}`;
  }
  const wholeHours = Math.floor(hours);
  const mins = Math.round((hours - wholeHours) * 60);
  return `${wholeHours}h ${mins}m`;
}

export default function SettingsPanel({
  active,
  isAdmin,
  userRole = "",
  userLabel = "",
  userEmail = "",
  initialDays = 30,
  onSaved,
}: SettingsPanelProps) {
  const [days, setDays] = useState<number>(initialDays);
  const [persistentConfirmationQueue, setPersistentConfirmationQueue] = useState<boolean>(false);
  const [callbackDelayHours, setCallbackDelayHours] = useState<number>(24);
  const [durationUnit, setDurationUnit] = useState<"hours" | "minutes">("hours");
  const [cartUpsellTag, setCartUpsellTag] = useState<string>("cart_upsell");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedShopifyWebhook, setCopiedShopifyWebhook] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [shopifyWebhookUrl, setShopifyWebhookUrl] = useState("");
  const [layoutPref, setLayoutPref] = useState<"sheets" | "cards">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("satmi_confirmation_view_layout") as "sheets" | "cards") || "sheets";
    }
    return "sheets";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      setWebhookUrl(`${window.location.origin}/api/webhooks/orders`);
      setShopifyWebhookUrl(`${window.location.origin}/api/webhooks/shopify`);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      setLoading(true);
      fetch("/api/settings")
        .then((res) => res.json())
        .then((data) => {
          if (data.unshippedOrdersWindowDays) {
            setDays(Number(data.unshippedOrdersWindowDays));
          }
          if (typeof data.persistentConfirmationQueue === "boolean") {
            setPersistentConfirmationQueue(data.persistentConfirmationQueue);
          }
          if (data.callbackDelayHours) {
            const hrs = Number(data.callbackDelayHours);
            setCallbackDelayHours(hrs);
            if (hrs < 1 || !Number.isInteger(hrs)) {
              setDurationUnit("minutes");
            } else {
              setDurationUnit("hours");
            }
          }
          if (data.cartUpsellTag) {
            setCartUpsellTag(String(data.cartUpsellTag));
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [active]);

  async function handleSave(overrides?: {
    unshippedOrdersWindowDays?: number;
    persistentConfirmationQueue?: boolean;
    callbackDelayHours?: number;
    cartUpsellTag?: string;
  }) {
    setSaving(true);
    setSuccessMessage("");
    setErrorMessage("");
    const payload = {
      unshippedOrdersWindowDays: overrides?.unshippedOrdersWindowDays ?? days,
      persistentConfirmationQueue: overrides?.persistentConfirmationQueue ?? persistentConfirmationQueue,
      callbackDelayHours: overrides?.callbackDelayHours ?? callbackDelayHours,
      cartUpsellTag: overrides?.cartUpsellTag ?? cartUpsellTag,
    };
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "satmi-orders-dashboard",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update settings");
      }
      setSuccessMessage("Dashboard & Confirmation settings saved successfully.");
      if (onSaved) onSaved(payload.unshippedOrdersWindowDays);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  function handleCopyWebhook() {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCopyShopifyWebhook() {
    if (!shopifyWebhookUrl) return;
    navigator.clipboard.writeText(shopifyWebhookUrl).then(() => {
      setCopiedShopifyWebhook(true);
      setTimeout(() => setCopiedShopifyWebhook(false), 2000);
    });
  }

  const cartIntegrationSnippet = `// 1. In your custom Shopify Cart Drawer / Upsell App (Storefront Cart AJAX API):
await fetch('/cart/update.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    attributes: {
      '${cartUpsellTag || "cart_upsell"}': 'true',
      '_cart_upsell': 'true'
    }
  })
});

// 2. Or when adding the upsell item to cart (/cart/add.js):
await fetch('/cart/add.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    items: [{
      id: UPSELL_VARIANT_ID,
      quantity: 1,
      properties: { '_upsell': 'true' }
    }],
    attributes: { '${cartUpsellTag || "cart_upsell"}': 'true' }
  })
});`;

  function handleCopySnippet() {
    navigator.clipboard.writeText(cartIntegrationSnippet).then(() => {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    });
  }

  if (!isAdmin) {
    return (
      <div className={`space-y-6 ${!active ? "view-hidden" : ""}`}>
        {/* Top Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
              Support Workspace
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Customer Support Settings
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Personal workspace preferences and verification queue configuration
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-500">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Agent Active
            </span>
          </div>
        </div>

        {/* Grid of Structured Cards */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* CARD 1: Support Agent Profile */}
          <section className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
            <header className="border-b border-border bg-muted/30 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <User size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold tracking-tight text-foreground">
                    Agent Profile
                  </h2>
                  <p className="text-xs text-muted-foreground">Account and assigned role</p>
                </div>
              </div>
              <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary capitalize">
                {userRole === "support_agent" || userRole === "customer_support" ? "Customer Support" : userRole ? userRole.replaceAll("_", " ") : "Support Agent"}
              </span>
            </header>

            <div className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1">
                  <span className="text-[11px] text-muted-foreground font-medium">Full Name</span>
                  <p className="font-bold text-foreground text-sm truncate">{userLabel || "Customer Support Agent"}</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1">
                  <span className="text-[11px] text-muted-foreground font-medium">Email Address</span>
                  <p className="font-bold text-foreground text-sm truncate">{userEmail || "support@satmi.in"}</p>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2.5">
                <span className="font-bold text-foreground block text-xs">Assigned Operational Permissions:</span>
                <ul className="space-y-2 text-[11px] text-muted-foreground">
                  <li className="flex items-center gap-2 text-foreground font-medium">
                    <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                    <span>Customer Confirmation Calls &amp; Approvals</span>
                  </li>
                  <li className="flex items-center gap-2 text-foreground font-medium">
                    <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                    <span>Logging Call Attempts (Callbacks &amp; Unreachable)</span>
                  </li>
                  <li className="flex items-center gap-2 text-foreground font-medium">
                    <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                    <span>Logging Customer Rejections &amp; Order Cancellations</span>
                  </li>
                  <li className="flex items-center gap-2 text-foreground font-medium">
                    <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                    <span>Activity Audit Trail for your account</span>
                  </li>
                  <li className="flex items-center gap-2 opacity-70">
                    <Lock size={14} className="text-muted-foreground shrink-0" />
                    <span>Order Shipments &amp; Inventory Operations (Operations Only)</span>
                  </li>
                  <li className="flex items-center gap-2 opacity-70">
                    <Lock size={14} className="text-muted-foreground shrink-0" />
                    <span>Shipping Delay Justifications (Operations Only)</span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* CARD 2: Confirmation Calling Workflow Preferences */}
          <section className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
            <header className="border-b border-border bg-muted/30 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                  <PhoneCall size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold tracking-tight text-foreground">
                    Confirmation View Preferences
                  </h2>
                  <p className="text-xs text-muted-foreground">Customize your verification queue layout</p>
                </div>
              </div>
            </header>

            <div className="p-6 space-y-5">
              <div>
                <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2.5">
                  Default Queue Layout
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setLayoutPref("sheets");
                      if (typeof window !== "undefined") {
                        localStorage.setItem("satmi_confirmation_view_layout", "sheets");
                      }
                    }}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                      layoutPref === "sheets"
                        ? "border-primary bg-primary/10 text-primary shadow-xs ring-1 ring-primary/30"
                        : "border-border bg-card text-foreground hover:bg-muted/40"
                    }`}
                  >
                    <Table size={18} className="shrink-0 mt-0.5" />
                    <div>
                      <span className="text-xs font-bold block">Spreadsheet View</span>
                      <span className="text-[10px] text-muted-foreground">Dense tabular layout for fast calling</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setLayoutPref("cards");
                      if (typeof window !== "undefined") {
                        localStorage.setItem("satmi_confirmation_view_layout", "cards");
                      }
                    }}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                      layoutPref === "cards"
                        ? "border-primary bg-primary/10 text-primary shadow-xs ring-1 ring-primary/30"
                        : "border-border bg-card text-foreground hover:bg-muted/40"
                    }`}
                  >
                    <LayoutGrid size={18} className="shrink-0 mt-0.5" />
                    <div>
                      <span className="text-xs font-bold block">Cards View</span>
                      <span className="text-[10px] text-muted-foreground">Expanded cards with full customer details</span>
                    </div>
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-border">
                <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Calling Guidance Note
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  When calling customers, always verify their delivery address, pincode, and confirm whether they prefer COD cash payment or UPI upon delivery.
                </p>
              </div>
            </div>
          </section>

          {/* CARD 3: System Overview (Read-Only) */}
          <section className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
            <header className="border-b border-border bg-muted/30 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                  <Server size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold tracking-tight text-foreground">
                    Connected Integrations
                  </h2>
                  <p className="text-xs text-muted-foreground">Live channels for order fulfillment</p>
                </div>
              </div>
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                Live
              </span>
            </header>

            <div className="p-6">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1">
                  <dt className="text-muted-foreground font-semibold text-[11px]">Primary Carrier</dt>
                  <dd className="font-bold text-foreground text-sm">Shiprocket API v2</dd>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1">
                  <dt className="text-muted-foreground font-semibold text-[11px]">Store Channel</dt>
                  <dd className="font-bold text-foreground text-sm">Satmi (Shopify)</dd>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1">
                  <dt className="text-muted-foreground font-semibold text-[11px]">Unshipped Orders Window</dt>
                  <dd className="font-bold text-foreground text-sm">{days} Days (Admin managed)</dd>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1">
                  <dt className="text-muted-foreground font-semibold text-[11px]">Sync Mode</dt>
                  <dd className="font-bold text-foreground text-sm">Real-time Webhook</dd>
                </div>
              </dl>
            </div>
          </section>

          {/* CARD 4: Confirmation & Risk Policy */}
          <section className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
            <header className="border-b border-border bg-muted/30 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                  <ShieldCheck size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold tracking-tight text-foreground">
                    Confirmation &amp; Risk Policy
                  </h2>
                  <p className="text-xs text-muted-foreground">Automated RTO verification criteria</p>
                </div>
              </div>
              <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-500">
                Enforced
              </span>
            </header>

            <div className="p-6 space-y-3 text-xs">
              <p className="text-muted-foreground leading-relaxed">
                Orders are automatically routed to the <strong>Verification Queue</strong> if:
              </p>
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/20 p-3">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-500 font-bold text-[10px]">
                    1
                  </span>
                  <span className="text-foreground font-medium">
                    Shiprocket ML risk prediction marks the order as <strong>High</strong> or <strong>Very High</strong> risk.
                  </span>
                </div>
                <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/20 p-3">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-500 font-bold text-[10px]">
                    2
                  </span>
                  <span className="text-foreground font-medium">
                    The order contains checkout risk tags: <code>rto_prediction_high</code>, <code>high</code>, <code>very-high</code>, <code>high_rto</code>, or <code>high_risk</code>.
                  </span>
                </div>
                <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/20 p-3">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-500 font-bold text-[10px]">
                    3
                  </span>
                  <span className="text-foreground font-medium">
                    The COD order originates from the custom Shopify Cart with an upsell product (tagged <code>{cartUpsellTag}</code>), even if RTO risk is Low.
                  </span>
                </div>
              </div>
              <div className="pt-2 border-t border-border/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  Queue Persistence: <strong className="text-foreground">{persistentConfirmationQueue ? "Persistent (Always Visible)" : "Cooldown Hidden"}</strong>
                </span>
                <span>
                  Recall Cooldown: <strong className="text-foreground">{formatDurationLabel(callbackDelayHours)}</strong>
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${!active ? "view-hidden" : ""}`}>
      {/* Top Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
            System Configuration
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Dashboard &amp; Integration Settings
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure order lookback cutoffs, confirmation queue persistence, callback timers, and Shopify cart upsell routing
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-500">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live Sync Active
          </span>
        </div>
      </div>

      {/* Status Alerts */}
      {successMessage && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-600 dark:text-emerald-400">
          <Check size={18} className="shrink-0" />
          <span className="font-semibold">{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          <AlertCircle size={18} className="shrink-0" />
          <span className="font-semibold">{errorMessage}</span>
        </div>
      )}

      {/* Grid of Structured Cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* CARD 1: Confirmation Queue & Callback Controls (NEW) */}
        <section className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden transition-all duration-150">
          <header className="border-b border-border bg-muted/30 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                <PhoneCall size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold tracking-tight text-foreground">
                  Confirmation Queue &amp; Callback Controls
                </h2>
                <p className="text-xs text-muted-foreground">Manage agent queue persistence and recall cooldown timeframe</p>
              </div>
            </div>
            <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-500">
              {persistentConfirmationQueue ? "Persistent Queue" : `${formatDurationLabel(callbackDelayHours)} Cooldown`}
            </span>
          </header>

          <div className="p-6 space-y-6">
            {/* Persistent Queue Toggle */}
            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <label htmlFor="persistent-queue-toggle" className="text-xs font-bold text-foreground cursor-pointer block">
                    Persistent Confirmation Queue (Keep Orders Visible After Call Attempt)
                  </label>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    When enabled, logging a <strong>No Answer</strong> or <strong>Callback</strong> query will <strong>not</strong> hide the order from the customer support agent&apos;s dashboard. Orders stay visible in the queue until confirmed, rejected, or 3 attempts are completed.
                  </p>
                </div>
                <button
                  id="persistent-queue-toggle"
                  type="button"
                  role="switch"
                  aria-checked={persistentConfirmationQueue}
                  disabled={saving || loading}
                  onClick={() => {
                    const nextVal = !persistentConfirmationQueue;
                    setPersistentConfirmationQueue(nextVal);
                    void handleSave({ persistentConfirmationQueue: nextVal });
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    persistentConfirmationQueue ? "bg-emerald-500" : "bg-muted-foreground/30"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      persistentConfirmationQueue ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center gap-2 pt-1 text-[11px]">
                <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-bold ${
                  persistentConfirmationQueue
                    ? "bg-emerald-500/15 text-emerald-500"
                    : "bg-amber-500/15 text-amber-500"
                }`}>
                  {persistentConfirmationQueue
                    ? "✓ Persistent Mode ON: Unanswered & callback orders remain on agent screen"
                    : `⏱ Cooldown Mode ON: Orders hide for ${formatDurationLabel(callbackDelayHours)} before re-appearing`}
                </span>
              </div>
            </div>

            {/* Callback / Recall Timeframe Selector */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Callback &amp; Unreachable Cooldown Timeframe
                </span>
                <span className="text-xs font-bold text-primary flex items-center gap-1">
                  <Clock size={13} /> {formatDurationLabel(callbackDelayHours)}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CALLBACK_PRESETS.map((preset) => {
                  const isSelected = Math.abs(callbackDelayHours - preset.hours) < 0.001;
                  return (
                    <button
                      key={preset.hours}
                      type="button"
                      onClick={() => {
                        setCallbackDelayHours(preset.hours);
                        setDurationUnit("hours");
                      }}
                      className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary shadow-xs ring-1 ring-primary/30"
                          : "border-border bg-card text-foreground hover:border-border/80 hover:bg-muted/40"
                      }`}
                    >
                      <span className="text-xs font-bold">{preset.label}</span>
                      <span className="text-[10px] text-muted-foreground mt-0.5">{preset.desc}</span>
                    </button>
                  );
                })}
              </div>

              <div className="pt-1 space-y-2">
                <label htmlFor="custom-callback-duration" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Or Enter Any Custom Timeframe
                </label>
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      id="custom-callback-duration"
                      type="number"
                      min="1"
                      max={durationUnit === "minutes" ? "43200" : "720"}
                      step="1"
                      value={
                        durationUnit === "minutes"
                          ? Math.max(1, Math.round(callbackDelayHours * 60))
                          : Math.max(1, Math.round(callbackDelayHours * 100) / 100)
                      }
                      onChange={(e) => {
                        const rawVal = Math.max(1, parseFloat(e.target.value) || 1);
                        if (durationUnit === "minutes") {
                          setCallbackDelayHours(Math.min(720, rawVal / 60));
                        } else {
                          setCallbackDelayHours(Math.min(720, rawVal));
                        }
                      }}
                      className="h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm font-semibold text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                    />
                    <select
                      aria-label="Duration unit"
                      value={durationUnit}
                      onChange={(e) => setDurationUnit(e.target.value as "hours" | "minutes")}
                      className="h-11 rounded-xl border border-input bg-card px-3 text-xs font-bold text-foreground outline-none transition focus:border-ring"
                    >
                      <option value="hours">Hours</option>
                      <option value="minutes">Minutes</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving || loading}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <RefreshCw size={15} className="animate-spin" />
                        <span>Saving…</span>
                      </>
                    ) : (
                      <>
                        <Save size={15} />
                        <span>Save Settings</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CARD 2: Custom Shopify Cart & Upsell Confirmation Routing (NEW) */}
        <section className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden transition-all duration-150">
          <header className="border-b border-border bg-muted/30 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
                <ShoppingCart size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold tracking-tight text-foreground">
                  Shopify Custom Cart &amp; Upsell Routing
                </h2>
                <p className="text-xs text-muted-foreground">Force COD confirmation for custom cart upsell orders (including Low RTO)</p>
              </div>
            </div>
            <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-500">
              Active Rule
            </span>
          </header>

          <div className="p-6 space-y-5 text-xs">
            <p className="text-muted-foreground leading-relaxed">
              COD orders placed via your custom Shopify Cart that include an upsell item are <strong>automatically routed to the Confirmation Queue first</strong>—even if Shiprocket predicts them as Low RTO risk.
            </p>

            {/* Configurable Tag / Attribute Identifier */}
            <div className="space-y-2">
              <label htmlFor="cart-upsell-tag-input" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Order Tag / Cart Attribute Key
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="cart-upsell-tag-input"
                  type="text"
                  value={cartUpsellTag}
                  onChange={(e) => setCartUpsellTag(e.target.value)}
                  placeholder="cart_upsell"
                  className="h-11 flex-1 rounded-xl border border-input bg-card px-3.5 font-mono text-xs font-semibold text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                />
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || loading}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
                >
                  <Save size={14} />
                  <span>Save Tag</span>
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Matches Shopify order tag <code>{cartUpsellTag || "cart_upsell"}</code>, cart note attribute <code>{cartUpsellTag || "cart_upsell"}=true</code>, or line-item property <code>_upsell=true</code>.
              </p>
            </div>

            {/* Direct Shopify Webhook Endpoint */}
            <div>
              <label htmlFor="shopify-webhook-url-input" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                Shopify Order Webhook URL (Optional Instant Sync)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="shopify-webhook-url-input"
                  type="text"
                  readOnly
                  value={shopifyWebhookUrl || "https://satmi.in/api/webhooks/shopify"}
                  className="h-10 flex-1 rounded-xl border border-input bg-muted/40 px-3 font-mono text-[11px] text-foreground outline-none select-all"
                />
                <button
                  type="button"
                  onClick={handleCopyShopifyWebhook}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-xs font-semibold text-foreground transition hover:bg-muted"
                >
                  {copiedShopifyWebhook ? (
                    <>
                      <Check size={14} className="text-emerald-500" />
                      <span className="text-emerald-500 font-bold">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={14} className="text-muted-foreground" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Code snippet for Custom Cart App */}
            <div className="rounded-xl border border-border bg-muted/30 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-foreground text-[11px]">
                  How to connect your Custom Shopify Cart App:
                </span>
                <button
                  type="button"
                  onClick={handleCopySnippet}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] font-semibold text-foreground hover:bg-muted"
                >
                  {copiedSnippet ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  <span>{copiedSnippet ? "Copied Snippet" : "Copy JS"}</span>
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-background/80 p-2.5 font-mono text-[10.5px] leading-relaxed text-foreground border border-border/60">
                {cartIntegrationSnippet}
              </pre>
            </div>
          </div>
        </section>

        {/* CARD 3: Unshipped Orders Lookback Window */}
        <section className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden transition-all duration-150">
          <header className="border-b border-border bg-muted/30 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sliders size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold tracking-tight text-foreground">
                  Unshipped Orders Window
                </h2>
                <p className="text-xs text-muted-foreground">Filter threshold for NEW orders queue</p>
              </div>
            </div>
            <span className="rounded-md border border-border bg-card px-2 py-0.5 text-[10px] font-bold text-foreground">
              {days} Days
            </span>
          </header>

          <div className="p-6 space-y-6">
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Quick Lookback Presets
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {PRESET_OPTIONS.map((opt) => {
                  const isSelected = days === opt.days;
                  return (
                    <button
                      key={opt.days}
                      type="button"
                      onClick={() => setDays(opt.days)}
                      className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary shadow-xs ring-1 ring-primary/30"
                          : "border-border bg-card text-foreground hover:border-border/80 hover:bg-muted/40"
                      }`}
                    >
                      <span className="text-xs font-bold">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="custom-days-input" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Or Enter Custom Days (1–365)
              </label>
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <input
                    id="custom-days-input"
                    type="number"
                    min="1"
                    max="365"
                    value={days || ""}
                    onChange={(e) =>
                      setDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1)))
                    }
                    className="h-11 w-full rounded-xl border border-input bg-card px-3.5 pr-14 text-sm font-semibold text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                  />
                  <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                    days
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || loading}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      <Save size={15} />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-foreground flex items-start gap-3">
              <HelpCircle size={16} className="shrink-0 text-primary mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-primary">How this affects your dashboard:</p>
                <p className="text-muted-foreground leading-relaxed">
                  Orders placed within the last <strong>{days} days</strong> will be shown in the{" "}
                  <strong>NEW</strong> tab. Older unshipped orders placed more than {days} days ago
                  are archived from the active counter so your team focuses on current backlogs.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CARD 2: Real-time Webhook Configuration */}
        <section className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden transition-all duration-150">
          <header className="border-b border-border bg-muted/30 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                <Radio size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold tracking-tight text-foreground">
                  Carrier Webhook Endpoint
                </h2>
                <p className="text-xs text-muted-foreground">Instant event notifications from Shiprocket</p>
              </div>
            </div>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
              Active
            </span>
          </header>

          <div className="p-6 space-y-5">
            <div>
              <label htmlFor="webhook-url-input" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Production Webhook URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="webhook-url-input"
                  type="text"
                  readOnly
                  value={webhookUrl || "https://satmi.in/api/webhooks/orders"}
                  className="h-11 flex-1 rounded-xl border border-input bg-muted/40 px-3.5 font-mono text-xs text-foreground outline-none select-all"
                />
                <button
                  type="button"
                  onClick={handleCopyWebhook}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-xs font-semibold text-foreground transition hover:border-ring/50 hover:bg-muted"
                  title="Copy webhook URL"
                >
                  {copied ? (
                    <>
                      <Check size={15} className="text-emerald-500" />
                      <span className="text-emerald-500 font-bold">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={15} className="text-muted-foreground" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Supported Real-Time Triggers
              </span>
              <div className="grid grid-cols-2 gap-2">
                {TRIGGER_EVENTS.map((event) => (
                  <div
                    key={event.name}
                    className="flex items-center gap-2 rounded-lg border border-border/80 bg-muted/20 px-3 py-2 text-xs"
                  >
                    <span className="size-1.5 rounded-full bg-primary shrink-0" />
                    <span className="font-semibold text-foreground truncate">{event.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
              <span className="font-bold text-foreground block">Carrier Portal Setup:</span>
              <ol className="list-decimal list-inside space-y-1.5 leading-relaxed text-[11px]">
                <li>In Shiprocket, navigate to <strong>Settings</strong> → <strong>API</strong> → <strong>Webhooks</strong>.</li>
                <li>Add a new webhook using the endpoint URL copied above.</li>
                <li>Ensure triggers for <code>Order Shipped</code>, <code>Out For Delivery</code>, and <code>NDR</code> are checked.</li>
              </ol>
            </div>
          </div>
        </section>

        {/* CARD 3: Logistics & Carrier Infrastructure */}
        <section className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden transition-all duration-150">
          <header className="border-b border-border bg-muted/30 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                <Server size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold tracking-tight text-foreground">
                  Channel &amp; Provider Metadata
                </h2>
                <p className="text-xs text-muted-foreground">Connected Shiprocket and Shopify integrations</p>
              </div>
            </div>
            <span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-500">
              Synced
            </span>
          </header>

          <div className="p-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-1">
                <dt className="text-muted-foreground font-semibold">Primary Carrier</dt>
                <dd className="font-bold text-foreground text-sm">Shiprocket API v2</dd>
              </div>
              <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-1">
                <dt className="text-muted-foreground font-semibold">Default Channel</dt>
                <dd className="font-bold text-foreground text-sm">Satmi (Shopify_5)</dd>
              </div>
              <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-1">
                <dt className="text-muted-foreground font-semibold">Channel ID</dt>
                <dd className="font-bold font-mono text-foreground">9574697</dd>
              </div>
              <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-1">
                <dt className="text-muted-foreground font-semibold">Sync Architecture</dt>
                <dd className="font-bold text-foreground">Webhooks + Cron Daemon</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* CARD 4: Confirmation & High-Risk Routing Protocol */}
        <section className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden transition-all duration-150">
          <header className="border-b border-border bg-muted/30 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                <ShieldCheck size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold tracking-tight text-foreground">
                  Confirmation &amp; Risk Policy
                </h2>
                <p className="text-xs text-muted-foreground">Automated RTO verification criteria</p>
              </div>
            </div>
            <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-500">
              Enforced
            </span>
          </header>

          <div className="p-6 space-y-4 text-xs">
            <p className="text-muted-foreground leading-relaxed">
              Orders are automatically routed to the <strong>High RTO Confirmation Campaign</strong> if
              either:
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/20 p-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-500 font-bold text-[10px]">
                  1
                </span>
                <span className="text-foreground font-medium">
                  Shiprocket ML risk prediction marks the order as <strong>High</strong> or <strong>Very High</strong>.
                </span>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/20 p-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-500 font-bold text-[10px]">
                  2
                </span>
                <span className="text-foreground font-medium">
                  The order contains checkout risk tags: <code>rto_prediction_high</code>, <code>high</code>, <code>very-high</code>, <code>high_rto</code>, or <code>high_risk</code>.
                </span>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-violet-400 font-bold text-[10px]">
                  3
                </span>
                <span className="text-foreground font-medium">
                  The COD order originates from the custom Shopify Cart containing an upsell item (<code>{cartUpsellTag || "cart_upsell"}</code> tag or <code>_cart_upsell=true</code> cart attribute), even if Low RTO risk.
                </span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground italic">
              Administrators can configure persistent queue visibility and custom callback cooldown delays above.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
