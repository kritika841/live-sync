"use client";

import { useEffect, useState } from "react";
import { Check, Copy, HelpCircle, Save, Sliders, RefreshCw } from "lucide-react";

interface SettingsPanelProps {
  active: boolean;
  isAdmin: boolean;
  initialDays?: number;
  onSaved?: (newDays: number) => void;
}

const PRESET_OPTIONS = [
  { days: 7, label: "7 Days" },
  { days: 14, label: "14 Days (2 weeks)" },
  { days: 30, label: "30 Days (1 month - Recommended)" },
  { days: 60, label: "60 Days (2 months)" },
  { days: 90, label: "90 Days (3 months)" },
];

export default function SettingsPanel({ active, isAdmin, initialDays = 30, onSaved }: SettingsPanelProps) {
  const [days, setDays] = useState<number>(initialDays);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setWebhookUrl(`${window.location.origin}/api/webhooks/orders`);
    }
  }, []);

  useEffect(() => {
    if (!active || !isAdmin) return;
    setLoading(true);
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.unshippedOrdersWindowDays) {
          setDays(Number(data.unshippedOrdersWindowDays));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [active, isAdmin]);

  async function handleSave() {
    setSaving(true);
    setSuccessMessage("");
    setErrorMessage("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "satmi-orders-dashboard",
        },
        body: JSON.stringify({ unshippedOrdersWindowDays: days }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update settings");
      }
      setSuccessMessage(`Unshipped orders window successfully updated to ${days} days.`);
      if (onSaved) onSaved(days);
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

  if (!isAdmin) {
    return (
      <section className={`settings-card ${!active ? "view-hidden" : ""}`}>
        <div className="settings-unauthorized">
          <h3>Access Restricted</h3>
          <p>You need Administrator privileges to access and configure system settings.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`settings-card ${!active ? "view-hidden" : ""}`}>
      <header className="settings-heading">
        <div>
          <p className="eyebrow">System Preferences</p>
          <h2>Dashboard & Order Settings</h2>
          <p>Configure order cutoff thresholds, background sync rules, and webhook integration.</p>
        </div>
      </header>

      {successMessage && (
        <div className="settings-alert success">
          <Check size={18} />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="settings-alert error">
          <span>!</span>
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="settings-grid">
        {/* Unshipped Orders Window Section */}
        <div className="settings-section">
          <div className="settings-section-header">
            <Sliders size={20} className="section-icon" />
            <div>
              <h3>Unshipped Orders Window (NEW Tab Filter)</h3>
              <p>
                Controls how far back to look for unfulfilled orders in the <strong>NEW</strong> tab.
                Orders placed before this threshold that remain unshipped in Shiprocket will be omitted from the
                daily active queue and badge counts.
              </p>
            </div>
          </div>

          <div className="settings-body">
            <label className="settings-label">Quick Presets</label>
            <div className="settings-presets">
              {PRESET_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  type="button"
                  className={`preset-chip ${days === opt.days ? "active" : ""}`}
                  onClick={() => setDays(opt.days)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="settings-custom-input">
              <label htmlFor="custom-days-input">Or enter custom number of days:</label>
              <div className="input-group">
                <input
                  id="custom-days-input"
                  type="number"
                  min="1"
                  max="365"
                  value={days || ""}
                  onChange={(e) => setDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1)))}
                  className="days-number-field"
                />
                <span className="input-suffix">days</span>
              </div>
              <small className="help-text">
                <HelpCircle size={14} /> Orders created within the last <strong>{days} days</strong> will be shown in the NEW tab.
                Older prehistoric unshipped orders will be hidden.
              </small>
            </div>

            <div className="settings-actions">
              <button
                type="button"
                className="save-settings-btn"
                disabled={saving || loading}
                onClick={handleSave}
              >
                {saving ? (
                  <>
                    <RefreshCw size={16} className="spinner-icon" /> Saving…
                  </>
                ) : (
                  <>
                    <Save size={16} /> Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Webhook Configuration Section */}
        <div className="settings-section webhook-section">
          <div className="settings-section-header">
            <Copy size={20} className="section-icon" />
            <div>
              <h3>Live Order & Tracking Webhook Configuration</h3>
              <p>
                For real-time status updates (shipped, out for delivery, delivered, NDR, cancelled), configure this
                webhook endpoint in your logistics or carrier dashboard.
              </p>
            </div>
          </div>

          <div className="settings-body">
            <div className="webhook-box">
              <label className="settings-label">Your Live Webhook URL</label>
              <div className="copy-row">
                <input
                  type="text"
                  readOnly
                  value={webhookUrl || "https://satmi.in/api/webhooks/orders"}
                  className="webhook-url-input"
                />
                <button
                  type="button"
                  className="copy-btn"
                  onClick={handleCopyWebhook}
                  title="Copy webhook URL"
                >
                  {copied ? <Check size={16} className="check-green" /> : <Copy size={16} />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
            </div>

            <div className="webhook-instructions">
              <h4>Setup in Logistics / Carrier Portal:</h4>
              <ol>
                <li>
                  Go to <strong>Settings</strong> → <strong>API</strong> → <strong>Webhooks</strong>.
                </li>
                <li>
                  Click <strong>Add Webhook</strong> and paste the URL above (<code>/api/webhooks/orders</code>).
                </li>
                <li>
                  Add Authentication Header: <code>x-api-key: &lt;WEBHOOK_SECRET&gt;</code> (or append <code>?token=&lt;WEBHOOK_SECRET&gt;</code>).
                </li>
                <li>
                  Select Triggers: <code>Order Shipped</code>, <code>Out For Delivery</code>, <code>Order Delivered</code>, <code>NDR / Undelivered</code>, <code>Order Cancelled</code>, <code>AWB Assigned</code>.
                </li>
              </ol>
              <div style={{ marginTop: "12px", fontSize: "12px", color: "rgba(255, 255, 255, 0.55)" }}>
                <em>Alternative active endpoints:</em> <code>/api/webhooks/tracking</code> or <code>/api/events/order-status</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
