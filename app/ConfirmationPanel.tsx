"use client";

import { completePhone } from "../lib/contact";
import { Modal } from "./Modal";
import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  PhoneCall, PhoneMissed, CheckCircle2, GripVertical, MoreHorizontal, Search,
  UsersRound, Plus, Menu, ChevronLeft, ChevronRight, ChevronDown, Table, LayoutGrid, X, Trash2,
  AlertTriangle, Clock
} from "lucide-react";
import { isTransientRequestError, readJson } from "../lib/http";

type Attempt = { attemptNumber: number; outcome: string; note: string; rejectionReason?: string; nextActionAt?: string; createdAt: string };
type ConfirmationOrder = {
  id: number; channelOrderId: string; customerName: string; customerPhone: string; customerCity: string;
  customerState: string; customerAddress: string; customerPincode: string; orderDate: string; status: string;
  awb?: string; courier?: string; shippedAt?: string; deliveredAt?: string;
  paymentMethod: string; total: number; products: Array<{ name?: string; quantity?: number; sku?: string }>;
  confirmationStatus: string; campaignName?: string; confirmedAt?: string; rejectedAt?: string; phoneMasked?: boolean; tags: string[]; attempts: Attempt[];
  confirmationAssigneeId?: string; confirmationAssigneeName?: string;
  assignedAt?: string; confirmationUpdatedAt?: string;
  delayReason?: string; delayReasonUpdatedAt?: string;
};
export type DelayedConfirmedOrder = {
  id: number;
  channelOrderId: string;
  customerName: string;
  customerPhone: string;
  customerCity?: string;
  customerState?: string;
  total: number;
  status: string;
  confirmedAt: string;
  hoursDelayed: number;
  delayReason?: string;
  delayReasonUpdatedAt?: string;
  requiresPrompt: boolean;
};
export type DelayLogEntry = {
  id: number;
  orderId: number;
  channelOrderId: string;
  reasonCode: string;
  reasonText: string;
  notes: string;
  hoursDelayed: number;
  actorName: string;
  actorRole: string;
  createdAt: string;
};
type Campaign = {
  id: string; name: string; description: string; position: number; isActive: boolean; autoAssign: boolean;
  orderCount: number; criteria: { risk?: string; paymentMethod?: string; tags?: string[]; dateFrom?: string; dateTo?: string };
};
type DateGroup = { date: string; count: number };
type ConfirmationData = {
  queue: ConfirmationOrder[]; confirmed: ConfirmationOrder[]; rejected: ConfirmationOrder[]; candidates: ConfirmationOrder[];
  campaigns: Campaign[]; availableTags: string[]; counts: { queue: number; confirmed: number; confirmedPending?: number; confirmedShipped?: number; rejected: number; approved: number };
  agents: Array<{userId:string;name:string}>;
  dateGroups?: DateGroup[];
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  nextOffset?: number;
  delayedOrders?: DelayedConfirmedOrder[];
};
type Mode = "queue" | "confirmed" | "rejected";
type OrderAction = "confirm" | "callback" | "unreachable" | "reject";
type DateBasis = "allotted" | "order";
type ViewLayout = "sheets" | "cards";

const emptyData: ConfirmationData = {
  queue: [], confirmed: [], rejected: [], candidates: [], campaigns: [], availableTags: [], agents: [],
  dateGroups: [],
  counts: { queue: 0, confirmed: 0, confirmedPending: 0, confirmedShipped: 0, rejected: 0, approved: 0 },
  delayedOrders: [],
};

const samplePreviewData: ConfirmationData = {
  queue: [
    {
      id: 1571295312,
      channelOrderId: "SI0714199",
      customerName: "Sanjay Singhania",
      customerPhone: "70701 70270",
      customerCity: "Surat",
      customerState: "Gujarat",
      customerAddress: "402, Royal Residency, Ring Road",
      customerPincode: "395002",
      orderDate: "2026-09-24T10:30:00+05:30",
      status: "New",
      paymentMethod: "COD",
      total: 499,
      products: [{ name: "Nag Champa Refill Pack – Bambooless Incense Sticks (Pack of 100 Sticks)", quantity: 1, sku: "NC-100" }],
      confirmationStatus: "pending",
      assignedAt: "2026-09-24T05:30:00.000Z",
      tags: ["high_rto"],
      attempts: [
        { attemptNumber: 1, outcome: "no_answer", note: "Customer did not pick up", createdAt: "2026-09-24T06:00:00Z" },
        { attemptNumber: 2, outcome: "callback", note: "Callback requested in afternoon", createdAt: "2026-09-24T08:30:00Z" },
        { attemptNumber: 3, outcome: "no_answer", note: "3rd call attempt made", createdAt: "2026-09-24T11:15:00Z" }
      ],
      campaignName: "Default High RTO",
    },
    {
      id: 1608417130,
      channelOrderId: "SI0721072",
      customerName: "Meera Nair",
      customerPhone: "98470 11223",
      customerCity: "Kochi",
      customerState: "Kerala",
      customerAddress: "Flat 3B, Palm Grove",
      customerPincode: "682001",
      orderDate: "2026-09-24T12:16:00+05:30",
      status: "New",
      paymentMethod: "COD",
      total: 750,
      products: [{ name: "Kesar Chandan Refill Pack – Bambooless Incense Sticks", quantity: 2, sku: "KC-100" }],
      confirmationStatus: "pending",
      assignedAt: "2026-09-24T06:48:14.000Z",
      tags: ["verified_phone"],
      attempts: [],
      campaignName: "Default High RTO",
    },
    {
      id: 1606243699,
      channelOrderId: "SI0720942",
      customerName: "Aarav Patel",
      customerPhone: "98200 45678",
      customerCity: "Ahmedabad",
      customerState: "Gujarat",
      customerAddress: "12 Gulmohar Park",
      customerPincode: "380015",
      orderDate: "2026-09-23T12:00:00+05:30",
      status: "New",
      paymentMethod: "COD",
      total: 1299,
      products: [{ name: "Loban & Guggal Charcoal Free Dhoop Sticks (Pack of 80)", quantity: 2, sku: "LOB-80" }],
      confirmationStatus: "pending",
      assignedAt: "2026-09-23T07:24:52.000Z",
      tags: ["high_rto", "express"],
      attempts: [{ attemptNumber: 1, outcome: "callback", note: "Busy in meeting, call at 5 PM", createdAt: "2026-09-23T09:00:00Z" }],
      campaignName: "High RTO verification",
    },
    {
      id: 1605900486,
      channelOrderId: "SI0720921",
      customerName: "Rohan Gupta",
      customerPhone: "99881 22334",
      customerCity: "Delhi",
      customerState: "Delhi",
      customerAddress: "C-14, Greater Kailash 1",
      customerPincode: "110048",
      orderDate: "2026-09-23T08:50:00+05:30",
      status: "New",
      paymentMethod: "COD",
      total: 899,
      products: [{ name: "Pure Sandalwood Temple Incense Cones (Pack of 60)", quantity: 1, sku: "SND-60" }],
      confirmationStatus: "pending",
      assignedAt: "2026-09-23T05:26:25.000Z",
      tags: ["high_rto", "first_time"],
      attempts: [],
      campaignName: "High RTO verification",
    },
    {
      id: 1605821034,
      channelOrderId: "SI0720899",
      customerName: "Vikramaditya Rao",
      customerPhone: "98765 43210",
      customerCity: "Bengaluru",
      customerState: "Karnataka",
      customerAddress: "42, 8th Main, Indiranagar",
      customerPincode: "560038",
      orderDate: "2026-09-23T14:15:00+05:30",
      status: "New",
      paymentMethod: "COD",
      total: 2450,
      products: [{ name: "Handcrafted Ceramic Incense Burner + Charcoal Cones Set", quantity: 1, sku: "BRN-SET" }],
      confirmationStatus: "pending",
      assignedAt: "2026-09-23T08:45:00.000Z",
      tags: ["high_rto", "high_value"],
      attempts: [{ attemptNumber: 1, outcome: "callback", note: "Customer asked to verify address in evening", createdAt: "2026-09-23T10:00:00Z" }],
      campaignName: "High RTO verification",
    },
    {
      id: 1605754921,
      channelOrderId: "SI0720888",
      customerName: "Sneha Sengupta",
      customerPhone: "98301 23456",
      customerCity: "Kolkata",
      customerState: "West Bengal",
      customerAddress: "Flat 4A, Southern Avenue",
      customerPincode: "700029",
      orderDate: "2026-09-23T16:20:00+05:30",
      status: "New",
      paymentMethod: "COD",
      total: 1120,
      products: [{ name: "Organic Patchouli & Vetiver Incense (Pack of 100)", quantity: 2, sku: "PV-100" }],
      confirmationStatus: "pending",
      assignedAt: "2026-09-23T11:00:00.000Z",
      tags: ["high_rto"],
      attempts: [{ attemptNumber: 1, outcome: "no_answer", note: "No answer on 1st call", createdAt: "2026-09-23T11:30:00Z" }],
      campaignName: "High RTO verification",
    },
    {
      id: 1605638102,
      channelOrderId: "SI0720875",
      customerName: "Manish Choudhary",
      customerPhone: "98290 87654",
      customerCity: "Jaipur",
      customerState: "Rajasthan",
      customerAddress: "Plot 88, Vaishali Nagar",
      customerPincode: "302021",
      orderDate: "2026-09-23T18:40:00+05:30",
      status: "New",
      paymentMethod: "COD",
      total: 699,
      products: [{ name: "Camphor Cone Purifying Air Freshener (Pack of 3)", quantity: 1, sku: "CMP-3" }],
      confirmationStatus: "pending",
      assignedAt: "2026-09-23T13:10:00.000Z",
      tags: ["high_rto", "pincode_alert"],
      attempts: [],
      campaignName: "High RTO verification",
    },
    {
      id: 1605408299,
      channelOrderId: "SI0720877",
      customerName: "Pooja Verma",
      customerPhone: "91234 56789",
      customerCity: "Pune",
      customerState: "Maharashtra",
      customerAddress: "Tower 2, Magarpatta City",
      customerPincode: "411028",
      orderDate: "2026-09-22T21:52:00+05:30",
      status: "New",
      paymentMethod: "COD",
      total: 1450,
      products: [{ name: "Rose & Jasmine Dhoop Sticks Refill Pack", quantity: 3, sku: "RJ-100" }],
      confirmationStatus: "pending",
      assignedAt: "2026-09-22T16:00:00.000Z",
      tags: ["high_rto", "first_time"],
      attempts: [{ attemptNumber: 1, outcome: "no_answer", note: "Ringing no response", createdAt: "2026-09-22T17:00:00Z" }],
      campaignName: "High RTO verification",
    },
    {
      id: 1604901234,
      channelOrderId: "SI0720810",
      customerName: "Deepak Sharma",
      customerPhone: "98110 33445",
      customerCity: "Jaipur",
      customerState: "Rajasthan",
      customerAddress: "Plot 45, Malviya Nagar",
      customerPincode: "302017",
      orderDate: "2026-09-21T18:20:00+05:30",
      status: "New",
      paymentMethod: "COD",
      total: 620,
      products: [{ name: "Camphor Cone Purifying Air Freshener", quantity: 2, sku: "CMP-2" }],
      confirmationStatus: "pending",
      assignedAt: "2026-09-21T13:00:00.000Z",
      tags: ["high_rto", "repeat_buyer"],
      attempts: [{ attemptNumber: 1, outcome: "callback", note: "Asked to confirm next morning", createdAt: "2026-09-21T14:30:00Z" }],
      campaignName: "High RTO verification",
    },
    {
      id: 1603501234,
      channelOrderId: "SI0720750",
      customerName: "Kavita Reddy",
      customerPhone: "98490 55667",
      customerCity: "Hyderabad",
      customerState: "Telangana",
      customerAddress: "Flat 401, Jubilee Hills",
      customerPincode: "500033",
      orderDate: "2026-09-20T15:40:00+05:30",
      status: "New",
      paymentMethod: "COD",
      total: 999,
      products: [{ name: "Organic Patchouli & Vetiver Incense", quantity: 1, sku: "PV-50" }],
      confirmationStatus: "pending",
      assignedAt: "2026-09-20T10:15:00.000Z",
      tags: ["high_rto"],
      attempts: [],
      campaignName: "High RTO verification",
    },
  ],
  confirmed: [
    {
      id: 1577317570,
      channelOrderId: "SI0718950",
      customerName: "Karan Johar",
      customerPhone: "98200 99887",
      customerCity: "Mumbai",
      customerState: "Maharashtra",
      customerAddress: "Bandra West",
      customerPincode: "400050",
      orderDate: "2026-09-10T18:56:00+05:30",
      status: "IN TRANSIT",
      awb: "14326589102",
      courier: "Delhivery",
      paymentMethod: "COD",
      total: 890,
      products: [{ name: "Nag Champa Refill Pack – Bambooless Incense Sticks", quantity: 2 }],
      confirmationStatus: "confirmed",
      confirmedAt: "2026-09-24T07:15:00.000Z",
      assignedAt: "2026-09-24T05:30:00.000Z",
      tags: [],
      attempts: [{ attemptNumber: 1, outcome: "confirmed", note: "Customer confirmed delivery address and COD amount", createdAt: "2026-09-24T07:15:00.000Z" }],
    },
    {
      id: 1577317571,
      channelOrderId: "SI0718951",
      customerName: "Vikas Sharma",
      customerPhone: "98711 22334",
      customerCity: "New Delhi",
      customerState: "Delhi",
      customerAddress: "Sector 14 Dwarka",
      customerPincode: "110078",
      orderDate: "2026-09-22T10:00:00+05:30",
      status: "NEW",
      paymentMethod: "COD",
      total: 1499,
      products: [{ name: "Organic Karungali Bracelet – 8mm Beads", quantity: 1 }],
      confirmationStatus: "confirmed",
      confirmedAt: new Date(Date.now() - 32 * 3600 * 1000).toISOString(),
      assignedAt: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
      delayReason: "",
      delayReasonUpdatedAt: "",
      tags: ["COD", "high"],
      attempts: [{ attemptNumber: 1, outcome: "confirmed", note: "Customer verified and confirmed order", createdAt: new Date(Date.now() - 32 * 3600 * 1000).toISOString() }],
    }
  ],
  rejected: [],
  candidates: [],
  campaigns: [
    {
      id: "cmp_default_high_rto",
      name: "High RTO verification",
      description: "Auto-routes high RTO risk COD orders",
      position: 1,
      isActive: true,
      autoAssign: true,
      orderCount: 10,
      criteria: { risk: "high", paymentMethod: "cod" }
    }
  ],
  availableTags: ["high_rto", "repeat_caller", "express", "vip", "first_time", "high_value", "pincode_alert"],
  agents: [{ userId: "ag_1", name: "Priya Sharma" }, { userId: "ag_2", name: "Rahul Varma" }],
  dateGroups: [
    { date: "2026-09-24", count: 3 },
    { date: "2026-09-23", count: 5 },
    { date: "2026-09-22", count: 9 },
    { date: "2026-09-21", count: 7 },
    { date: "2026-09-20", count: 13 },
    { date: "2026-09-19", count: 7 },
    { date: "2026-09-18", count: 12 },
    { date: "2026-09-17", count: 8 },
    { date: "2026-09-16", count: 7 },
    { date: "2026-09-15", count: 10 },
    { date: "2026-09-14", count: 9 },
    { date: "2026-09-13", count: 10 },
    { date: "2026-09-12", count: 13 },
    { date: "2026-09-11", count: 13 },
    { date: "2026-09-10", count: 3 },
  ],
  counts: { queue: 10, confirmed: 2, confirmedPending: 1, confirmedShipped: 1, rejected: 0, approved: 2 },
  delayedOrders: [
    {
      id: 1577317571,
      channelOrderId: "SI0718951",
      customerName: "Vikas Sharma",
      customerPhone: "98711 22334",
      customerCity: "New Delhi",
      customerState: "Delhi",
      total: 1499,
      status: "NEW",
      confirmedAt: new Date(Date.now() - 32 * 3600 * 1000).toISOString(),
      hoursDelayed: 32,
      delayReason: "",
      delayReasonUpdatedAt: "",
      requiresPrompt: true,
    }
  ]
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getLocalDayStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftMonth(monthStr: string, delta: number): string {
  try {
    const [y, m] = monthStr.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const ny = d.getFullYear();
    const nm = String(d.getMonth() + 1).padStart(2, "0");
    return `${ny}-${nm}`;
  } catch {
    return monthStr;
  }
}

function formatMonthLabel(monthStr: string): string {
  try {
    const [y, m] = monthStr.split("-").map(Number);
    const mName = MONTH_NAMES[m - 1] || "";
    return `${mName} ${y}`;
  } catch {
    return monthStr;
  }
}

function formatTabDateLabel(dateStr: string, isToday = false, isYesterday = false): string {
  try {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const day = parseInt(parts[2], 10);
      const monthIdx = parseInt(parts[1], 10) - 1;
      const month = MONTH_NAMES[monthIdx] || "";
      if (isToday) return `Today (${day} ${month})`;
      if (isYesterday) return `Yesterday (${day} ${month})`;
      return `${day} ${month}`;
    }
  } catch {
    // fallback to raw date string
  }
  return dateStr;
}

function formatDateRangeLabel(fromStr: string, toStr: string): string {
  if (!fromStr && !toStr) return "All Dates";
  if (fromStr === toStr) return formatTabDateLabel(fromStr);
  try {
    const [y1, m1, d1] = fromStr.split("-").map(Number);
    const [y2, m2, d2] = toStr.split("-").map(Number);
    const mName1 = MONTH_NAMES[m1 - 1] || "";
    const mName2 = MONTH_NAMES[m2 - 1] || "";
    if (y1 === y2 && m1 === m2) {
      return `${d1}- ${d2} ${mName1}`;
    }
    return `${d1} ${mName1} - ${d2} ${mName2}`;
  } catch {
    // fallback to raw date range
  }
  return `${fromStr} - ${toStr}`;
}

function getOrderDateStr(order: ConfirmationOrder, basis: DateBasis): string {
  let rawDate = "";
  if (basis === "allotted") {
    rawDate = order.assignedAt || order.orderDate || order.confirmationUpdatedAt || order.confirmedAt || order.rejectedAt || "";
  } else {
    rawDate = order.orderDate || order.confirmedAt || order.rejectedAt || order.assignedAt || "";
  }
  if (!rawDate) return "";
  return rawDate.slice(0, 10);
}

function when(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function productSummary(products: ConfirmationOrder["products"]) {
  return products.length ? products.map((product) => `${product.name || product.sku || "Product"}${product.quantity ? ` ×${product.quantity}` : ""}`).join(", ") : "—";
}

function fulfillmentBadge(order: ConfirmationOrder, onOpenDelayLogs?: (order: ConfirmationOrder) => void) {
  const s = String(order.status || "").trim().toUpperCase();
  const confirmedTime = Date.parse(order.confirmedAt || "");
  const hoursDelayed = Number.isFinite(confirmedTime) ? Math.max(0, Math.round((Date.now() - confirmedTime) / 3600000)) : 0;
  const isUnfulfilled = ["NEW", "NEW ORDER", "PENDING", "PENDING ORDER", "PROCESSING", "CONFIRMED"].some((st) => s.includes(st)) && !order.shippedAt;

  let mainBadge = <div className="confirmed-badge pending">⏳ Pending warehouse fulfillment</div>;
  if (s.includes("DELIVERED") && !s.includes("RTO")) {
    mainBadge = <div className="confirmed-badge delivered">✓ Delivered {order.deliveredAt ? `(${when(order.deliveredAt)})` : ""} {order.awb ? `· AWB ${order.awb}` : ""}</div>;
  } else if (["SHIPPED", "IN TRANSIT", "IN TRANSIT-EN-ROUTE", "IN TRANSIT-AT DESTINATION HUB", "OUT FOR DELIVERY", "PICKED UP"].some((st) => s.includes(st))) {
    mainBadge = <div className="confirmed-badge shipped">🚚 {order.status} {order.courier ? `· ${order.courier}` : ""} {order.awb ? `· AWB ${order.awb}` : ""}</div>;
  } else if (["READY TO SHIP", "AWB ASSIGNED", "PICKUP SCHEDULED", "MANIFEST GENERATED"].some((st) => s.includes(st))) {
    mainBadge = <div className="confirmed-badge ready">📦 Ready to ship {order.awb ? `· AWB ${order.awb}` : ""}</div>;
  } else if (s.includes("CANCEL")) {
    mainBadge = <div className="confirmed-badge cancelled">✕ Cancelled in Shiprocket</div>;
  }

  return (
    <div className="fulfillment-badge-container" style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end" }}>
      {mainBadge}
      {order.delayReason ? (
        <button
          type="button"
          onClick={() => onOpenDelayLogs?.(order)}
          className="delay-reason-pill"
          title={`Delay Reason: ${order.delayReason}. Click to view complete audit trail.`}
        >
          <Clock size={11} /> Delay: {order.delayReason.length > 25 ? order.delayReason.slice(0, 25) + "…" : order.delayReason}
        </button>
      ) : isUnfulfilled && hoursDelayed >= 24 ? (
        <button
          type="button"
          onClick={() => onOpenDelayLogs?.(order)}
          className="delay-reason-pill warning"
          title={`Order unfulfilled for ${hoursDelayed} hours after confirmation. Delay reason required.`}
        >
          <AlertTriangle size={11} /> ⚠️ {hoursDelayed}h unfulfilled
        </button>
      ) : null}
    </div>
  );
}

function MandatoryDelayDialog({
  order,
  submitting,
  onSubmit,
}: {
  order: DelayedConfirmedOrder | null;
  submitting: boolean;
  onSubmit: (category: string, notes: string) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [notesError, setNotesError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (order) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          // fallback
        }
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [order]);

  useEffect(() => {
    if (!order) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [order]);

  if (!order) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!category) {
      setCategoryError("Please select a delay reason");
      return;
    }
    if (notes.trim().length < 5) {
      setNotesError("Please enter notes with at least 5 characters");
      return;
    }
    await onSubmit(category, notes.trim());
    setCategory("");
    setNotes("");
    setCategoryError("");
    setNotesError("");
  }

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog mandatory-delay-dialog-native"
      aria-label="Action Required: Confirmed Order Delayed > 24 Hours"
      onCancel={(e) => {
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      style={{
        width: "min(640px, calc(100vw - 32px))",
        borderRadius: "16px",
        border: "1px solid #ef4444",
        padding: 0,
        boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.75), 0 0 0 2px rgba(239, 68, 68, 0.35)",
        background: "hsl(var(--card))",
        color: "hsl(var(--foreground))",
        overflow: "hidden"
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "20px 24px",
          background: "linear-gradient(135deg, rgba(239, 68, 68, 0.18) 0%, rgba(245, 158, 11, 0.12) 100%)",
          borderBottom: "1px solid hsl(var(--border))",
          display: "flex",
          alignItems: "flex-start",
          gap: "14px"
        }}
      >
        <div
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "12px",
            background: "#ef4444",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            flexShrink: 0,
            boxShadow: "0 4px 12px rgba(239, 68, 68, 0.4)"
          }}
        >
          ⚠️
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "inline-block",
              padding: "3px 9px",
              borderRadius: "4px",
              background: "rgba(239, 68, 68, 0.2)",
              color: "#ef4444",
              fontSize: "11px",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "6px"
            }}
          >
            Fulfillment Compliance Alert
          </div>
          <h2 style={{ margin: "0 0 4px", fontSize: "19px", fontWeight: 800, letterSpacing: "-0.02em", color: "hsl(var(--foreground))" }}>
            Action Required: Confirmed Order Delayed &gt; 24h
          </h2>
          <p style={{ margin: 0, fontSize: "12px", lineHeight: "1.45", color: "hsl(var(--muted-foreground))" }}>
            This customer order was confirmed over 24 hours ago and has not been marked shipped yet.
            Shiprocket compliance requires an explanation and action plan before you can proceed.
          </p>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Order Details Card */}
        <div
          style={{
            background: "hsl(var(--muted) / 0.4)",
            border: "1px solid hsl(var(--border))",
            borderRadius: "12px",
            padding: "14px 18px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px 16px",
            fontSize: "12px"
          }}
        >
          <div>
            <span style={{ color: "hsl(var(--muted-foreground))", display: "block", fontSize: "10px", textTransform: "uppercase", fontWeight: 700 }}>
              Order ID
            </span>
            <strong style={{ fontSize: "15px", color: "hsl(var(--foreground))" }}>#{order.channelOrderId}</strong>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ color: "hsl(var(--muted-foreground))", display: "block", fontSize: "10px", textTransform: "uppercase", fontWeight: 700 }}>
              Delay Duration
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "3px 10px",
                borderRadius: "20px",
                background: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                fontWeight: 800,
                fontSize: "12px"
              }}
            >
              ⏱️ Delayed {Math.round(order.hoursDelayed || 24)}h
            </span>
          </div>
          <div>
            <span style={{ color: "hsl(var(--muted-foreground))", display: "block", fontSize: "10px", textTransform: "uppercase", fontWeight: 700 }}>
              Customer
            </span>
            <span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{order.customerName || "Customer"}</span>
            {order.customerCity && (
              <span style={{ color: "hsl(var(--muted-foreground))" }}> ({order.customerCity})</span>
            )}
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ color: "hsl(var(--muted-foreground))", display: "block", fontSize: "10px", textTransform: "uppercase", fontWeight: 700 }}>
              Current Status
            </span>
            <span
              style={{
                display: "inline-block",
                padding: "3px 8px",
                borderRadius: "6px",
                background: "rgba(245, 158, 11, 0.18)",
                color: "#f59e0b",
                fontWeight: 700,
                fontSize: "11px",
                textTransform: "uppercase"
              }}
            >
              {order.status || "NEW / Pending"}
            </span>
          </div>
          <div style={{ gridColumn: "span 2", paddingTop: "8px", borderTop: "1px dashed hsl(var(--border))", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "10px", textTransform: "uppercase", fontWeight: 700 }}>
                Confirmed At:{" "}
              </span>
              <span style={{ fontWeight: 500, color: "hsl(var(--foreground))" }}>{when(order.confirmedAt)}</span>
            </div>
            {order.delayReason && (
              <div>
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "10px", textTransform: "uppercase", fontWeight: 700 }}>
                  Last Logged:{" "}
                </span>
                <span style={{ color: "#ef4444", fontWeight: 600 }}>{order.delayReason}</span>
              </div>
            )}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", fontWeight: 700 }}>
            <span>
              Select Delay Reason <span style={{ color: "#ef4444" }}>*</span>
            </span>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setCategoryError("");
              }}
              disabled={submitting}
              required
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontSize: "13px",
                cursor: "pointer"
              }}
            >
              <option value="">-- Choose delay justification reason --</option>
              <option value="inventory_out_of_stock">Out of Stock / Inventory Shortage</option>
              <option value="address_verification">Customer Address Incomplete / Verification Pending</option>
              <option value="packaging_delayed">Packaging / Assembly in Progress</option>
              <option value="courier_pickup_delayed">Courier Pickup Delayed / Dispatch Backlog</option>
              <option value="customer_hold">Customer Requested Delivery Hold / Reschedule</option>
              <option value="quality_check">Quality Inspection Failed / Replacement Sourced</option>
              <option value="payment_verification">Payment / High-Value Verification Pending</option>
              <option value="other">Other Operational Reason</option>
            </select>
            {categoryError && <small style={{ color: "#ef4444" }}>{categoryError}</small>}
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", fontWeight: 700 }}>
            <span>
              Additional Notes &amp; Action Plan <span style={{ color: "#ef4444" }}>*</span> (min. 5 characters)
            </span>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                if (e.target.value.trim().length >= 5) setNotesError("");
              }}
              disabled={submitting}
              placeholder="Explain why the dispatch was delayed and when it will be handed to the courier..."
              rows={3}
              required
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontSize: "13px",
                resize: "vertical"
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {notesError ? (
                <small style={{ color: "#ef4444" }}>{notesError}</small>
              ) : (
                <small style={{ color: "hsl(var(--muted-foreground))" }}>
                  This reason will be logged in the permanent audit trail.
                </small>
              )}
              <small style={{ color: notes.trim().length >= 5 ? "#10b981" : "hsl(var(--muted-foreground))", fontWeight: 700 }}>
                {notes.trim().length}/5 min characters
              </small>
            </div>
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
            <button
              type="submit"
              disabled={submitting || !category || notes.trim().length < 5}
              style={{
                padding: "11px 22px",
                borderRadius: "8px",
                border: 0,
                background: (submitting || !category || notes.trim().length < 5) ? "hsl(var(--muted))" : "#ef4444",
                color: (submitting || !category || notes.trim().length < 5) ? "hsl(var(--muted-foreground))" : "#ffffff",
                fontWeight: 700,
                fontSize: "13px",
                cursor: (submitting || !category || notes.trim().length < 5) ? "not-allowed" : "pointer",
                transition: "all 0.15s ease",
                boxShadow: (submitting || !category || notes.trim().length < 5) ? "none" : "0 4px 14px rgba(239, 68, 68, 0.4)"
              }}
            >
              {submitting ? "Submitting Log..." : "Log Delay Reason & Continue"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

// Client-side cache for instant tab opening and snappy switches (SWR pattern)
interface ConfirmationCacheItem {
  data: Partial<ConfirmationData>;
  timestamp: number;
}
const confirmationDataCache = new Map<string, ConfirmationCacheItem>();

function getConfirmationCacheKey(
  section: string,
  mode: string,
  fulfillment: string,
  from: string,
  to: string,
  agent: string,
  basis: string
) {
  return `${section}:${mode}:${fulfillment}:${from}:${to}:${agent}:${basis}`;
}

// Structured skeleton mimicking exact table row layout & column widths
function ConfirmationTableSkeleton({ rowCount = 7 }: { rowCount?: number }) {
  return (
    <div className="sheets-grid-body sheets-skeleton-body" role="rowgroup" aria-busy="true" aria-label="Loading confirmation workspace">
      {Array.from({ length: rowCount }).map((_, idx) => (
        <div className="sheets-grid-row skeleton-shimmer-row" key={`skel-row-${idx}`}>
          <div className="sheets-grid-cell sheets-row-num" role="cell">
            <div className="skeleton-bone" style={{ width: "16px", height: "14px", margin: "0 auto", borderRadius: "3px" }} />
          </div>
          <div className="sheets-grid-cell sheets-col-order" role="cell">
            <div className="skeleton-bone" style={{ width: "68px", height: "13px", marginBottom: "4px", borderRadius: "3px" }} />
            <div className="skeleton-bone" style={{ width: "42px", height: "10px", borderRadius: "2px" }} />
          </div>
          <div className="sheets-grid-cell sheets-col-phone" role="cell">
            <div className="skeleton-bone" style={{ width: "95px", height: "14px", borderRadius: "3px" }} />
          </div>
          <div className="sheets-grid-cell sheets-col-product" role="cell" style={{ maxWidth: "260px" }}>
            <div className="skeleton-bone" style={{ width: "180px", height: "13px", marginBottom: "4px", borderRadius: "3px" }} />
            <div className="skeleton-bone" style={{ width: "110px", height: "10px", borderRadius: "2px" }} />
          </div>
          <div className="sheets-grid-cell sheets-col-status" role="cell">
            <div className="skeleton-bone" style={{ width: "55px", height: "20px", borderRadius: "99px" }} />
          </div>
          <div className="sheets-grid-cell sheets-col-payment" role="cell">
            <div className="skeleton-bone" style={{ width: "62px", height: "20px", borderRadius: "99px" }} />
          </div>
          <div className="sheets-grid-cell sheets-col-attempts" role="cell">
            <div className="skeleton-bone" style={{ width: "70px", height: "20px", borderRadius: "99px" }} />
          </div>
          <div className="sheets-grid-cell sheets-col-date" role="cell">
            <div className="skeleton-bone" style={{ width: "75px", height: "13px", borderRadius: "3px" }} />
          </div>
          <div className="sheets-grid-cell sheets-col-customer" role="cell">
            <div className="skeleton-bone" style={{ width: "100px", height: "13px", marginBottom: "4px", borderRadius: "3px" }} />
            <div className="skeleton-bone" style={{ width: "70px", height: "10px", borderRadius: "2px" }} />
          </div>
          <div className="sheets-grid-cell sheets-col-actions" role="cell">
            <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end", width: "100%", alignItems: "center" }}>
              <div className="skeleton-bone" style={{ width: "56px", height: "26px", borderRadius: "6px" }} />
              <div className="skeleton-bone" style={{ width: "56px", height: "26px", borderRadius: "6px" }} />
              <div className="skeleton-bone" style={{ width: "26px", height: "26px", borderRadius: "6px" }} />
              <div className="skeleton-bone" style={{ width: "26px", height: "26px", borderRadius: "6px" }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ConfirmationPanel({ active, section = "confirmation", preview = false, isAdmin = false }: { active: boolean; preview?: boolean; section?: "confirmation" | "campaigns"; isAdmin?: boolean }) {
  const [mode, setMode] = useState<Mode>("queue");
  const [data, setData] = useState<ConfirmationData>(() => preview ? samplePreviewData : emptyData);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ConfirmationOrder | null>(null);
  const [orderAction, setOrderAction] = useState<OrderAction>("confirm");
  const [note, setNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [rejectionReason, setRejectionReason] = useState("customer_cancelled");
  const [createOpen, setCreateOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [campaignPayment, setCampaignPayment] = useState("all");
  const [campaignDateFrom, setCampaignDateFrom] = useState("");
  const [campaignDateTo, setCampaignDateTo] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [autoAssign, setAutoAssign] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());
  const campaignElements = useRef(new Map<string, HTMLDivElement>());
  const campaignPositions = useRef(new Map<string, number>());
  const dragOriginal = useRef<Campaign[]>([]);
  const [draggedCampaignId, setDraggedCampaignId] = useState("");
  const [openCampaignMenu, setOpenCampaignMenu] = useState("");
  const [confirmationSearch, setConfirmationSearch] = useState("");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"all" | "pending" | "shipped">("all");
  const [confirmationFrom, setConfirmationFrom] = useState(() => getLocalDayStr(-1));
  const [confirmationTo, setConfirmationTo] = useState(() => getLocalDayStr(-1));
  const [confirmationAgent, setConfirmationAgent] = useState("");
  const [dateBasis, setDateBasis] = useState<DateBasis>("order");
  const [activeTabId, setActiveTabId] = useState<string>(() => `date:${getLocalDayStr(-1)}`);
  const [viewLayout, setViewLayout] = useState<ViewLayout>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("satmi_confirmation_view_layout");
      if (saved === "sheets") return "sheets";
      if (saved === "cards") {
        localStorage.setItem("satmi_confirmation_view_layout", "sheets");
        return "sheets";
      }
    }
    return "sheets";
  });
  const switchViewLayout = (layout: ViewLayout) => {
    setViewLayout(layout);
    if (typeof window !== "undefined") {
      localStorage.setItem("satmi_confirmation_view_layout", layout);
    }
  };
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getLocalDayStr(-1).slice(0, 7));
  const [allTabsOpen, setAllTabsOpen] = useState(false);
  const [addTabOpen, setAddTabOpen] = useState(false);
  const [newTabTitle, setNewTabTitle] = useState("");
  const [newTabFrom, setNewTabFrom] = useState("");
  const [newTabTo, setNewTabTo] = useState("");
  const [tabSearchQuery, setTabSearchQuery] = useState("");
  const [tabMenuOpen, setTabMenuOpen] = useState<string | null>(null);
  const tabsScrollRef = useRef<HTMLDivElement | null>(null);
  const isDraggingTabsRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragScrollLeftRef = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);

  const handleTabsPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input")) return;
    isDraggingTabsRef.current = true;
    dragStartXRef.current = e.clientX;
    dragScrollLeftRef.current = tabsScrollRef.current?.scrollLeft || 0;
  };

  const handleTabsPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingTabsRef.current || !tabsScrollRef.current) return;
    const dx = e.clientX - dragStartXRef.current;
    tabsScrollRef.current.scrollLeft = dragScrollLeftRef.current - dx;
  };

  const handleTabsPointerUp = () => {
    isDraggingTabsRef.current = false;
  };

  // Scroll active tab into view when activeTabId changes
  useEffect(() => {
    if (!tabsScrollRef.current) return;
    const activeEl = tabsScrollRef.current.querySelector<HTMLElement>(".sheets-sheet-tab.active");
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeTabId]);

  // Lazy loading state
  const [loadingMore, setLoadingMore] = useState(false);

  // Delay reason mandatory prompt state
  const [delaySubmitting, setDelaySubmitting] = useState(false);
  const [currentDelayedIndex, setCurrentDelayedIndex] = useState(0);

  // Delay logs inspection modal state
  const [inspectingDelayOrder, setInspectingDelayOrder] = useState<ConfirmationOrder | null>(null);
  const [inspectingLogs, setInspectingLogs] = useState<DelayLogEntry[]>([]);
  const [inspectingLogsLoading, setInspectingLogsLoading] = useState(false);

  const delayedOrdersNeedingPrompt = useMemo(() => {
    if (!isAdmin) return [];
    return (data.delayedOrders || []).filter((o) => o.requiresPrompt);
  }, [isAdmin, data.delayedOrders]);

  const activeDelayedOrder = delayedOrdersNeedingPrompt[currentDelayedIndex] || delayedOrdersNeedingPrompt[0] || null;

  // Intercept and prevent Escape key while mandatory delay modal is active
  useEffect(() => {
    if (!activeDelayedOrder) return;
    const preventEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", preventEscape, true);
    return () => window.removeEventListener("keydown", preventEscape, true);
  }, [activeDelayedOrder]);

  const [customTabs, setCustomTabs] = useState<Array<{ id: string; label: string; dateFrom: string; dateTo: string }>>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem("satmi_confirmation_custom_tabs");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const saveCustomTabs = (tabs: typeof customTabs) => {
    setCustomTabs(tabs);
    try {
      localStorage.setItem("satmi_confirmation_custom_tabs", JSON.stringify(tabs));
    } catch {
      // ignore storage error
    }
  };

  useLayoutEffect(() => {
    const next = new Map<string, number>();
    campaignElements.current.forEach((element, id) => {
      const top = element.offsetTop;
      next.set(id, top);
      const previous = campaignPositions.current.get(id);
      if (previous !== undefined && previous !== top && id !== draggedCampaignId && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        element.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "translateY(0)" }], { duration: 180, easing: "ease-out" });
      }
    });
    campaignPositions.current = next;
  }, [data.campaigns, draggedCampaignId]);

  const load = useCallback(async (quiet = false) => {
    if (loadAbort.current || (quiet && document.hidden)) return;
    const controller = new AbortController();
    loadAbort.current = controller;

    const cacheKey = getConfirmationCacheKey(section, mode, fulfillmentFilter, confirmationFrom, confirmationTo, confirmationAgent, dateBasis);
    const cached = confirmationDataCache.get(cacheKey);

    // If cached data is present, populate immediately and run background revalidation quietly (SWR)
    if (cached) {
      setData((current) => {
        const nextModeOrders = cached.data[mode] || current[mode] || [];
        return {
          ...current,
          ...cached.data,
          [mode]: nextModeOrders,
          counts: cached.data.counts ? { ...current.counts, ...cached.data.counts } : current.counts,
          total: cached.data.total ?? current.total,
          hasMore: Boolean(cached.data.hasMore),
          nextOffset: cached.data.nextOffset,
          delayedOrders: cached.data.delayedOrders ?? current.delayedOrders,
        };
      });
      setLoading(false);
      quiet = true; // silently fetch updates in background without blanking table
    } else if (!quiet) {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({ section, mode, limit: "400", offset: "0" });
      if (mode === "confirmed" && fulfillmentFilter !== "all") params.set("fulfillment", fulfillmentFilter);
      if (confirmationFrom) params.set("from", confirmationFrom);
      if (confirmationTo) params.set("to", confirmationTo);
      if (confirmationAgent) params.set("agent", confirmationAgent);
      if (dateBasis) params.set("dateBasis", dateBasis);
      if (section === "campaigns" && createOpen) params.set("candidates", "true");
      const response = await fetch(`/api/confirmation?${params}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
      const payload = await readJson<Partial<ConfirmationData>>(response);
      if (controller.signal.aborted) return;

      // Update cache
      confirmationDataCache.set(cacheKey, { data: payload, timestamp: Date.now() });

      setData((current) => {
        const nextModeOrders = payload[mode] || (quiet ? current[mode] : []) || [];
        return {
          ...current,
          ...payload,
          [mode]: nextModeOrders,
          counts: payload.counts ? { ...current.counts, ...payload.counts } : current.counts,
          total: payload.total ?? current.total,
          hasMore: Boolean(payload.hasMore),
          nextOffset: payload.nextOffset,
          delayedOrders: payload.delayedOrders ?? current.delayedOrders,
        };
      });
      setError("");
    } catch (cause) {
      if (!controller.signal.aborted && !quiet && !isTransientRequestError(cause)) {
        const msg = cause instanceof Error ? cause.message : "Could not load confirmations";
        if (!/signal timed out|timeout|timed out|abort/i.test(msg)) {
          setError(msg);
        }
      }
    } finally {
      if (loadAbort.current === controller) loadAbort.current = null;
      if (!controller.signal.aborted && !quiet) setLoading(false);
    }
  }, [mode, section, fulfillmentFilter, createOpen, confirmationFrom, confirmationTo, confirmationAgent, dateBasis]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !data.hasMore || preview) return;
    setLoadingMore(true);
    try {
      const currentOrders = data[mode] || [];
      const currentOffset = data.nextOffset ?? currentOrders.length;
      const params = new URLSearchParams({ section, mode, limit: "400", offset: String(currentOffset) });
      if (mode === "confirmed" && fulfillmentFilter !== "all") params.set("fulfillment", fulfillmentFilter);
      if (confirmationFrom) params.set("from", confirmationFrom);
      if (confirmationTo) params.set("to", confirmationTo);
      if (confirmationAgent) params.set("agent", confirmationAgent);
      if (dateBasis) params.set("dateBasis", dateBasis);
      const response = await fetch(`/api/confirmation?${params}`, { cache: "no-store", signal: AbortSignal.timeout(60000) });
      const payload = await readJson<ConfirmationData>(response);
      const newOrders = payload[mode] || [];
      setData((current) => {
        const existingMap = new Map((current[mode] || []).map((o) => [o.id, o]));
        newOrders.forEach((o) => existingMap.set(o.id, o));
        return {
          ...current,
          [mode]: Array.from(existingMap.values()),
          hasMore: Boolean(payload.hasMore),
          nextOffset: payload.nextOffset,
          total: payload.total ?? current.total,
        };
      });
    } catch (cause) {
      if (!isTransientRequestError(cause)) {
        const msg = cause instanceof Error ? cause.message : "Could not load more orders";
        if (!/signal timed out|timeout|timed out|abort/i.test(msg)) {
          setError(msg);
        }
      }
    } finally {
      setLoadingMore(false);
    }
  }, [data, mode, section, fulfillmentFilter, confirmationFrom, confirmationTo, confirmationAgent, dateBasis, loadingMore, preview]);

  useEffect(() => {
    if (!active || preview) return;
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(true), 30000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); loadAbort.current?.abort(); loadAbort.current = null; };
  }, [active, load, preview]);

  useEffect(() => {
    if (!createOpen && !addTabOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setCreateOpen(false);
        setAddTabOpen(false);
        setAllTabsOpen(false);
        setTabMenuOpen(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, createOpen, addTabOpen]);

  async function submitDelayReason(orderId: number, reasonCode: string, reasonText: string, notes: string) {
    if (preview) {
      setData((current) => ({
        ...current,
        delayedOrders: (current.delayedOrders || []).map((o) =>
          o.id === orderId ? { ...o, requiresPrompt: false, delayReason: `${reasonText}: ${notes}`, delayReasonUpdatedAt: new Date().toISOString() } : o
        ),
        confirmed: (current.confirmed || []).map((o) =>
          o.id === orderId ? { ...o, delayReason: `${reasonText}: ${notes}`, delayReasonUpdatedAt: new Date().toISOString() } : o
        ),
      }));
      return true;
    }
    try {
      const response = await fetch("/api/confirmation", {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "satmi-orders-dashboard" },
        body: JSON.stringify({ action: "log_delay_reason", orderId, reasonCode, reasonText, notes }),
      });
      const result = await readJson<{ ok: boolean; delayReason?: string; delayReasonUpdatedAt?: string }>(response);
      if (!response.ok) throw new Error("Failed to record delay reason");
      setData((current) => ({
        ...current,
        delayedOrders: (current.delayedOrders || []).map((o) =>
          o.id === orderId ? { ...o, requiresPrompt: false, delayReason: result.delayReason || "", delayReasonUpdatedAt: result.delayReasonUpdatedAt || "" } : o
        ),
        confirmed: (current.confirmed || []).map((o) =>
          o.id === orderId ? { ...o, delayReason: result.delayReason || "", delayReasonUpdatedAt: result.delayReasonUpdatedAt || "" } : o
        ),
      }));
      await load(true);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to record delay reason");
      return false;
    }
  }

  async function handleDelaySubmit(category: string, notesText: string) {
    if (!activeDelayedOrder) return;
    setDelaySubmitting(true);
    const categoryLabels: Record<string, string> = {
      inventory_out_of_stock: "Out of Stock / Inventory Shortage",
      address_verification: "Customer Address Incomplete / Verification Pending",
      packaging_delayed: "Packaging / Assembly in Progress",
      courier_pickup_delayed: "Courier Pickup Delayed / Dispatch Backlog",
      customer_hold: "Customer Requested Delivery Hold / Reschedule",
      quality_check: "Quality Inspection Failed / Replacement Sourced",
      payment_verification: "Payment / High-Value Verification Pending",
      other: "Other Operational Reason",
    };
    const summaryText = categoryLabels[category] || category.replace(/_/g, " ");
    const success = await submitDelayReason(activeDelayedOrder.id, category, summaryText, notesText.trim());
    if (success) {
      if (currentDelayedIndex < delayedOrdersNeedingPrompt.length - 1) {
        setCurrentDelayedIndex((i) => i + 1);
      } else {
        setCurrentDelayedIndex(0);
      }
    }
    setDelaySubmitting(false);
  }

  async function openDelayLogs(order: ConfirmationOrder) {
    setInspectingDelayOrder(order);
    setInspectingLogs([]);
    setInspectingLogsLoading(true);
    try {
      if (preview) {
        setInspectingLogs([
          {
            id: 1,
            orderId: order.id,
            channelOrderId: order.channelOrderId,
            reasonCode: "inventory_out_of_stock",
            reasonText: "Out of Stock / Inventory Shortage",
            notes: order.delayReason || "Supplier delivery delayed; scheduled for next batch dispatch.",
            hoursDelayed: 32,
            actorName: "Operations Admin",
            actorRole: "admin",
            createdAt: order.delayReasonUpdatedAt || new Date().toISOString(),
          }
        ]);
        return;
      }
      const res = await fetch(`/api/confirmation?section=delay_logs&orderId=${order.id}`, {
        cache: "no-store",
        headers: { "x-requested-with": "satmi-orders-dashboard" }
      });
      const payload = await readJson<{ logs: DelayLogEntry[] }>(res);
      setInspectingLogs(payload.logs || []);
    } catch {
      setInspectingLogs([]);
    } finally {
      setInspectingLogsLoading(false);
    }
  }

  async function post(payload: Record<string, unknown>) {
    if (preview) { setError("Connection unavailable"); return false; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/confirmation", {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "satmi-orders-dashboard" },
        body: JSON.stringify(payload),
      });
      await readJson(response);
      loadAbort.current?.abort();
      loadAbort.current = null;
      confirmationDataCache.clear();
      await load(true);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function refreshContacts() {
    setBusy(true); setError("");
    try {
      let after = 0;
      do {
        const payload = await readJson<{next:number|null}>(await fetch("/api/confirmation", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "satmi-orders-dashboard" }, body: JSON.stringify({ action: "refresh_contacts", after }) }));
        if (!payload.next) break;
        after = payload.next;
      } while (after > 0);
      await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Contact refresh failed"); }
    finally { setBusy(false); }
  }

  async function revealPhone(order: ConfirmationOrder) {
    if (preview || busy) return;
    setBusy(true); setError("");
    try {
      const result = await readJson<{customerPhone:string;phoneMasked:boolean}>(await fetch("/api/confirmation", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "satmi-orders-dashboard" }, body: JSON.stringify({ action: "reveal_phone", orderId: order.id }) }));
      setData(current => {
        const update = (orders: ConfirmationOrder[]) => orders.map(item => item.id === order.id ? { ...item, customerPhone: result.customerPhone, phoneMasked: result.phoneMasked } : item);
        return { ...current, queue: update(current.queue), confirmed: update(current.confirmed), rejected: update(current.rejected), candidates: update(current.candidates) };
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not look up the phone number"); }
    finally { setBusy(false); }
  }

  function phoneColumn(order: ConfirmationOrder) {
    const dialable = completePhone(order.customerPhone);
    return (
      <div className="confirmation-phone">
        {dialable ? (
          <a href={`tel:${dialable}`} style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
            <PhoneCall size={12} /> {dialable}
          </a>
        ) : order.customerPhone ? (
          <button type="button" disabled={busy || preview} onClick={() => void revealPhone(order)} title="Look up full number in Shopify">
            {order.customerPhone} <span>Reveal</span>
          </button>
        ) : (
          <button type="button" disabled={busy || preview} onClick={() => void revealPhone(order)}>
            Look up phone <span>Reveal</span>
          </button>
        )}
      </div>
    );
  }

  function openAction(order: ConfirmationOrder, action: OrderAction) {
    setSelectedOrder(order); setOrderAction(action); setNote(""); setCallbackAt(""); setRejectionReason("customer_cancelled");
  }

  function confirmationTags(order: ConfirmationOrder) {
    const rawTags = Array.isArray(order.tags) ? order.tags : [];
    const parsedTags: string[] = [];
    for (const t of rawTags) {
      if (typeof t === "string" && (t.startsWith("[") || t.startsWith("{"))) {
        try {
          const parsed = JSON.parse(t);
          if (Array.isArray(parsed)) {
            parsedTags.push(...parsed.map(String));
            continue;
          }
        } catch {
          // ignore malformed tag JSON
        }
      }
      if (t) parsedTags.push(String(t));
    }
    return (
      <div className="confirmation-tags">
        {parsedTags.length ? parsedTags.slice(0, 3).map((tag) => <span key={tag} title={tag}>{tag}</span>) : <small>No tags</small>}
        {parsedTags.length > 3 && <small title={parsedTags.slice(3).join(", ")}>+{parsedTags.length - 3}</small>}
      </div>
    );
  }

  async function submitOrderAction(event: FormEvent) {
    event.preventDefault();
    if (!selectedOrder) return;
    const complete = await post({ action: orderAction, orderId: selectedOrder.id, note, callbackAt: callbackAt ? new Date(callbackAt).toISOString() : "", rejectionReason });
    if (complete) setSelectedOrder(null);
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    const matchingIds = new Set(candidates.map((order) => order.id));
    const complete = await post({ action: "create_campaign", name: campaignName, description: campaignDescription, autoAssign, criteria: { paymentMethod: campaignPayment, tags: [...selectedTags], dateFrom: campaignDateFrom, dateTo: campaignDateTo }, orderIds: [...selectedCandidates].filter((id) => matchingIds.has(id)) });
    if (complete) { setCreateOpen(false); setCampaignName(""); setCampaignDescription(""); setSelectedCandidates(new Set()); setSelectedTags(new Set()); setCampaignDateFrom(""); setCampaignDateTo(""); }
  }

  async function moveCampaign(index: number, direction: -1 | 1) {
    const next = [...data.campaigns];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await post({ action: "reorder_campaigns", campaignIds: next.map((campaign) => campaign.id) });
  }

  function previewCampaign(targetId: string) {
    if (!draggedCampaignId || draggedCampaignId === targetId) return;
    setData(current => {
      const next = [...current.campaigns];
      const from = next.findIndex(c => c.id === draggedCampaignId), to = next.findIndex(c => c.id === targetId);
      if (from < 0 || to < 0) return current;
      const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
      return { ...current, campaigns: next };
    });
  }

  async function dropCampaign() {
    if (!draggedCampaignId) return;
    const original = dragOriginal.current;
    dragOriginal.current = [];
    setDraggedCampaignId("");
    if (!await post({ action: "reorder_campaigns", campaignIds: data.campaigns.map(c => c.id) })) {
      setData(current => ({ ...current, campaigns: original }));
    }
  }

  // Today and Yesterday dates in YYYY-MM-DD
  const todayStr = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, []);

  const yesterdayStr = useMemo(() => {
    const prev = new Date(Date.now() - 86400000);
    const y = prev.getFullYear();
    const m = String(prev.getMonth() + 1).padStart(2, "0");
    const d = String(prev.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, []);

  // Month options for filter dropdown
  const monthOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [];
    const curr = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(curr.getFullYear(), curr.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const lbl = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      opts.push({ value: val, label: lbl });
    }
    return opts;
  }, []);

  // Compute available date tabs: ensure all dates in the selected month up to today are present (never future dates)
  const dateTabs = useMemo(() => {
    const map = new Map<string, number>();
    for (const group of data.dateGroups || []) {
      if (group.date && group.date <= todayStr) map.set(group.date, Number(group.count || 0));
    }
    for (const order of data[mode] || []) {
      const d = getOrderDateStr(order, dateBasis);
      if (d && d <= todayStr && !map.has(d)) {
        map.set(d, (map.get(d) || 0) + 1);
      }
    }
    if (yesterdayStr <= todayStr && !map.has(yesterdayStr)) map.set(yesterdayStr, 0);
    if (!map.has(todayStr)) map.set(todayStr, 0);

    // Populate days of the selected month UP TO TODAY (never future dates)
    try {
      const [sy, sm] = selectedMonth.split("-").map(Number);
      if (Number.isFinite(sy) && Number.isFinite(sm) && sm >= 1 && sm <= 12) {
        const isCurrentMonth = selectedMonth === todayStr.slice(0, 7);
        const daysInMonth = new Date(sy, sm, 0).getDate();
        const maxDay = isCurrentMonth ? Math.min(daysInMonth, Number(todayStr.slice(8, 10))) : daysInMonth;

        if (selectedMonth <= todayStr.slice(0, 7)) {
          for (let d = 1; d <= maxDay; d++) {
            const dayStr = `${selectedMonth}-${String(d).padStart(2, "0")}`;
            if (dayStr <= todayStr && !map.has(dayStr)) {
              map.set(dayStr, 0);
            }
          }
        }
      }
    } catch {
      // ignore
    }

    // Filter out any date that falls in the future (strictly date <= todayStr)
    const dates = Array.from(map.keys())
      .filter((date) => date <= todayStr)
      .sort((a, b) => b.localeCompare(a));

    return dates.map((date) => {
      const isToday = date === todayStr;
      const isYesterday = date === yesterdayStr;
      return {
        id: `date:${date}`,
        dateFrom: date,
        dateTo: date,
        label: formatTabDateLabel(date, isToday, isYesterday),
        count: map.get(date) ?? 0,
      };
    });
  }, [data, mode, dateBasis, todayStr, yesterdayStr, selectedMonth]);

  // Filter date tabs by the currently selected month
  const monthDateTabs = useMemo(() => {
    return dateTabs.filter((tab) => tab.dateFrom.startsWith(selectedMonth));
  }, [dateTabs, selectedMonth]);

  const displayedTabs = useMemo(() => {
    if (monthDateTabs.length > 0) return monthDateTabs;
    const [y, m] = selectedMonth.split("-").map(Number);
    const isCurrentMonth = selectedMonth === todayStr.slice(0, 7);
    const daysInMonth = new Date(y, m, 0).getDate();
    const lastDay = isCurrentMonth ? Math.min(daysInMonth, Number(todayStr.slice(8, 10))) : daysInMonth;
    const toDate = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;
    return [
      {
        id: `month:${selectedMonth}`,
        dateFrom: `${selectedMonth}-01`,
        dateTo: toDate <= todayStr ? toDate : todayStr,
        label: `${formatMonthLabel(selectedMonth)} (All)`,
        count: 0,
      },
    ];
  }, [monthDateTabs, selectedMonth, todayStr]);

  function stepMonth(delta: number) {
    const nextVal = shiftMonth(selectedMonth, delta);
    const currentMonth = todayStr.slice(0, 7);
    if (delta > 0 && nextVal > currentMonth) return;
    handleMonthChange(nextVal);
  }

  function handleMonthChange(newMonth: string) {
    const currentMonth = todayStr.slice(0, 7);
    const safeMonth = newMonth > currentMonth ? currentMonth : newMonth;
    setSelectedMonth(safeMonth);
    const inMonth = dateTabs.filter((t) => t.dateFrom.startsWith(safeMonth));
    if (inMonth.length > 0) {
      const firstTab = inMonth[0];
      selectTab(firstTab.id, firstTab.dateFrom, firstTab.dateTo);
    } else {
      const [y, m] = safeMonth.split("-").map(Number);
      const isCurrentMonth = safeMonth === currentMonth;
      const daysInMonth = new Date(y, m, 0).getDate();
      const lastDay = isCurrentMonth ? Math.min(daysInMonth, Number(todayStr.slice(8, 10))) : daysInMonth;
      const from = `${safeMonth}-01`;
      const to = `${safeMonth}-${String(lastDay).padStart(2, "0")}`;
      selectTab(`month:${safeMonth}`, from, to);
    }
  }

  const isCustomRangeActive = useMemo(() => {
    if (!confirmationFrom || !confirmationTo) return false;
    const matchesSingleDate = dateTabs.some((t) => t.dateFrom === confirmationFrom && t.dateTo === confirmationTo);
    const matchesCustom = customTabs.some((t) => t.dateFrom === confirmationFrom && t.dateTo === confirmationTo);
    return !matchesSingleDate && !matchesCustom;
  }, [confirmationFrom, confirmationTo, dateTabs, customTabs]);

  const currentPreset = useMemo(() => {
    if (!confirmationFrom && !confirmationTo) return "all";
    if (confirmationFrom === yesterdayStr && confirmationTo === yesterdayStr) return "yesterday";
    if (confirmationFrom === todayStr && confirmationTo === todayStr) return "today";
    const curMonth = todayStr.slice(0, 7);
    const [cy, cm] = curMonth.split("-").map(Number);
    const curLastDay = new Date(cy, cm, 0).getDate();
    if (confirmationFrom === `${curMonth}-01` && confirmationTo === `${curMonth}-${String(curLastDay).padStart(2, "0")}`) return "this_month";
    const prevMonth = shiftMonth(curMonth, -1);
    const [py, pm] = prevMonth.split("-").map(Number);
    const prevLastDay = new Date(py, pm, 0).getDate();
    if (confirmationFrom === `${prevMonth}-01` && confirmationTo === `${prevMonth}-${String(prevLastDay).padStart(2, "0")}`) return "prev_month";
    return "";
  }, [confirmationFrom, confirmationTo, todayStr, yesterdayStr]);

  function selectTab(tabId: string, from = "", to = "") {
    setActiveTabId(tabId);
    setConfirmationFrom(from);
    setConfirmationTo(to);
    if (from && from.length >= 7) {
      setSelectedMonth(from.slice(0, 7));
    }
    setAllTabsOpen(false);
    setTabMenuOpen(null);

    // Instant SWR retrieval from cache
    const cacheKey = getConfirmationCacheKey(section, mode, fulfillmentFilter, from, to, confirmationAgent, dateBasis);
    const cached = confirmationDataCache.get(cacheKey);
    if (cached) {
      setData((current) => ({
        ...current,
        ...cached.data,
        [mode]: cached.data[mode] || current[mode] || [],
        counts: cached.data.counts ? { ...current.counts, ...cached.data.counts } : current.counts,
        total: cached.data.total ?? current.total,
        hasMore: Boolean(cached.data.hasMore),
        nextOffset: cached.data.nextOffset,
        delayedOrders: cached.data.delayedOrders ?? current.delayedOrders,
      }));
      setLoading(false);
    }
  }

  function handleAddCustomTab(e: FormEvent) {
    e.preventDefault();
    if (!newTabFrom || !newTabTo) return;
    const id = `custom_${Date.now()}`;
    const label = newTabTitle.trim() || formatDateRangeLabel(newTabFrom, newTabTo);
    const next = [...customTabs, { id, label, dateFrom: newTabFrom, dateTo: newTabTo }];
    saveCustomTabs(next);
    selectTab(id, newTabFrom, newTabTo);
    setAddTabOpen(false);
    setNewTabTitle("");
    setNewTabFrom("");
    setNewTabTo("");
  }

  function removeCustomTab(id: string) {
    const next = customTabs.filter((t) => t.id !== id);
    saveCustomTabs(next);
    if (activeTabId === id) {
      selectTab(`date:${yesterdayStr}`, yesterdayStr, yesterdayStr);
    }
    setTabMenuOpen(null);
  }

  function applyPreset(preset: "all" | "today" | "yesterday" | "this_month" | "prev_month" | "7d" | "14d" | "30d") {
    if (preset === "all") {
      selectTab("all_dates", "", "");
      return;
    }
    if (preset === "yesterday") {
      setSelectedMonth(yesterdayStr.slice(0, 7));
      selectTab(`date:${yesterdayStr}`, yesterdayStr, yesterdayStr);
      return;
    }
    if (preset === "today") {
      setSelectedMonth(todayStr.slice(0, 7));
      selectTab(`date:${todayStr}`, todayStr, todayStr);
      return;
    }
    if (preset === "this_month") {
      const curMonth = todayStr.slice(0, 7);
      setSelectedMonth(curMonth);
      const [y, m] = curMonth.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const from = `${curMonth}-01`;
      const to = `${curMonth}-${String(lastDay).padStart(2, "0")}`;
      selectTab(`month:${curMonth}`, from, to);
      return;
    }
    if (preset === "prev_month") {
      const prevM = shiftMonth(todayStr.slice(0, 7), -1);
      setSelectedMonth(prevM);
      const [y, m] = prevM.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const from = `${prevM}-01`;
      const to = `${prevM}-${String(lastDay).padStart(2, "0")}`;
      selectTab(`month:${prevM}`, from, to);
      return;
    }
    const now = new Date();
    const to = todayStr;
    const daysAgo = preset === "7d" ? 7 : preset === "14d" ? 14 : 30;
    const past = new Date(now.getTime() - daysAgo * 86400000);
    const py = past.getFullYear();
    const pm = String(past.getMonth() + 1).padStart(2, "0");
    const pd = String(past.getDate()).padStart(2, "0");
    const from = `${py}-${pm}-${pd}`;
    selectTab(`range:${from}:${to}`, from, to);
  }

  const candidates = (() => {
    const query = candidateSearch.trim().toLowerCase();
    return data.candidates.filter((order) => {
      if (campaignPayment !== "all" && order.paymentMethod?.toLowerCase() !== campaignPayment) return false;
      const orderTags = order.tags.map((tag) => tag.toLowerCase());
      if ([...selectedTags].some((tag) => !orderTags.includes(tag.toLowerCase()))) return false;
      const orderDate = order.orderDate.slice(0, 10);
      if (campaignDateFrom && orderDate < campaignDateFrom) return false;
      if (campaignDateTo && orderDate > campaignDateTo) return false;
      return !query || [order.channelOrderId, order.customerName, order.customerPhone].some((value) => value?.toLowerCase().includes(query));
    });
  })();

  const confirmationOrders = (data[mode] || []).filter((order) => {
    const query = confirmationSearch.trim().toLowerCase();
    if (query) {
      const digits = query.replace(/\D/g, "");
      const matchesSearch = [order.channelOrderId, order.customerName, order.customerPhone, order.customerCity, order.customerState]
        .some((value) => value?.toLowerCase().includes(query))
        || Boolean(digits && order.customerPhone?.replace(/\D/g, "").includes(digits));
      if (!matchesSearch) return false;
    }
    const orderDateStr = getOrderDateStr(order, dateBasis);
    if (confirmationFrom && orderDateStr && orderDateStr < confirmationFrom) return false;
    if (confirmationTo && orderDateStr && orderDateStr > confirmationTo) return false;
    return true;
  });

  return (
    <section className={`confirmation-view ${active ? "" : "view-hidden"}`}>
      {section === "confirmation" && (
        <div className="confirmation-mode-tabs">
          <button className={mode === "queue" ? "active" : ""} onClick={() => setMode("queue")}>
            <strong>Queue <b>{data.counts.queue}</b></strong>
          </button>
          <button className={mode === "confirmed" ? "active" : ""} onClick={() => setMode("confirmed")}>
            <strong>Confirmed <b>{data.counts.confirmed}</b></strong>
          </button>
          <button className={mode === "rejected" ? "active rejected" : ""} onClick={() => setMode("rejected")}>
            <strong>Rejected <b>{data.counts.rejected}</b></strong>
          </button>
        </div>
      )}

      {section === "confirmation" && (
        <div className="confirmation-contact-toolbar">
          <button disabled={busy || preview} onClick={() => void refreshContacts()}>
            {busy ? "Working…" : "Refresh Shopify phones & tags"}
          </button>
          <label className="confirmation-contact-filter">
            <Search size={16} />
            <input
              type="search"
              value={confirmationSearch}
              onChange={(event) => setConfirmationSearch(event.target.value)}
              placeholder="Filter by customer, phone, order #, city or state"
            />
            <span>{confirmationOrders.length} shown</span>
          </label>
          <label>
            Assigned agent
            <select value={confirmationAgent} onChange={(event) => setConfirmationAgent(event.target.value)}>
              <option value="">All agents</option>
              <option value="unassigned">Unassigned</option>
              {data.agents.map((agent) => <option value={agent.userId} key={agent.userId}>{agent.name}</option>)}
            </select>
          </label>
          <div className="view-toggle-group">
            <button
              type="button"
              className={`view-toggle-btn ${viewLayout === "cards" ? "active" : ""}`}
              onClick={() => switchViewLayout("cards")}
              title="Card layout (prehistoric view with pinned actions)"
            >
              <LayoutGrid size={14} /> <span>Cards view</span>
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${viewLayout === "sheets" ? "active" : ""}`}
              onClick={() => switchViewLayout("sheets")}
              title="Google Sheets layout"
            >
              <Table size={14} /> <span>Sheets view</span>
            </button>
          </div>
        </div>
      )}

      {error && !/signal timed out|timeout|timed out|abort/i.test(error) && <div className="error-banner"><span>!</span><p>{error}</p><button onClick={() => void load()}>Try again</button></div>}

      {/* MAIN VIEW CONTAINER WITH SPREADSHEET TABLE & BOTTOM GOOGLE SHEETS TAB BAR */}
      {section === "confirmation" && (
        <>
          <article className="sheets-tab-bar-card">
          <header className="confirmation-header">
            <div>
              <p className="eyebrow">
                {mode === "queue" ? "CONFIRMATION QUEUE" : mode === "confirmed" ? "CONFIRMED ORDERS" : "REJECTED ORDERS"}
              </p>
              <h2>
                {mode === "queue" ? "Customer Verification Queue" : mode === "confirmed" ? "Customer-Approved Orders" : "Manual Cancellation List"}
                {confirmationFrom && confirmationTo ? ` (${formatDateRangeLabel(confirmationFrom, confirmationTo)})` : " (All Dates)"}
              </h2>
              <p>
                {mode === "queue"
                  ? "Orders allotted on the selected day appear here. Switch between tabs above or filter by date."
                  : mode === "confirmed"
                    ? "Live shipping and fulfillment status for approved orders in this date range."
                    : "Orders cancelled during confirmation. Shiprocket is never cancelled automatically."}
              </p>
            </div>
            {mode === "confirmed" ? (
              <div className="confirmation-fulfillment-tabs" style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className={`sub-filter-tab ${fulfillmentFilter === "all" ? "active" : ""}`} onClick={() => setFulfillmentFilter("all")}>All ({data.counts.confirmed})</button>
                <button type="button" className={`sub-filter-tab ${fulfillmentFilter === "pending" ? "active" : ""}`} onClick={() => setFulfillmentFilter("pending")}>Pending fulfillment ({data.counts.confirmedPending ?? 0})</button>
                <button type="button" className={`sub-filter-tab ${fulfillmentFilter === "shipped" ? "active" : ""}`} onClick={() => setFulfillmentFilter("shipped")}>Shipped & delivered ({data.counts.confirmedShipped ?? 0})</button>
              </div>
            ) : (
              <span>{confirmationOrders.length} orders shown</span>
            )}
          </header>

          {/* DATE FILTER & TABS TOOLBAR - Positioned on top, right above the table */}
          <div className="confirmation-date-filter-top">
            {/* Filter Selection Date Toolbar */}
            <div className="confirmation-date-toolbar-row">
              <div className="confirmation-date-inputs">
                <label>
                  <span>From</span>
                  <input
                    type="date"
                    value={confirmationFrom}
                    max={confirmationTo ? (confirmationTo < todayStr ? confirmationTo : todayStr) : todayStr}
                    onChange={(e) => {
                      const val = e.target.value > todayStr ? todayStr : e.target.value;
                      setConfirmationFrom(val);
                      setActiveTabId(val && val === confirmationTo ? `date:${val}` : "custom");
                    }}
                  />
                </label>
                <label>
                  <span>To</span>
                  <input
                    type="date"
                    value={confirmationTo}
                    max={todayStr}
                    min={confirmationFrom || undefined}
                    onChange={(e) => {
                      const val = e.target.value > todayStr ? todayStr : e.target.value;
                      setConfirmationTo(val);
                      setActiveTabId(val && val === confirmationFrom ? `date:${val}` : "custom");
                    }}
                  />
                </label>
                <label title="Filter by month">
                  <span>Month</span>
                  <select
                    value={selectedMonth}
                    onChange={(e) => handleMonthChange(e.target.value)}
                  >
                    {monthOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
                <label title="Filter allotment date (when queued) or customer order date">
                  <span>Date basis</span>
                  <select value={dateBasis} onChange={(e) => setDateBasis(e.target.value as DateBasis)}>
                    <option value="order">Order Date</option>
                    <option value="allotted">Allotted Date</option>
                  </select>
                </label>
              </div>

              <div className="date-preset-pills">
                <button type="button" className={`date-preset-btn ${currentPreset === "yesterday" ? "active" : ""}`} onClick={() => applyPreset("yesterday")}>Yesterday</button>
                <button type="button" className={`date-preset-btn ${currentPreset === "today" ? "active" : ""}`} onClick={() => applyPreset("today")}>Today</button>
                <button type="button" className={`date-preset-btn ${currentPreset === "this_month" ? "active" : ""}`} onClick={() => applyPreset("this_month")}>This Month</button>
                <button type="button" className={`date-preset-btn ${currentPreset === "prev_month" ? "active" : ""}`} onClick={() => applyPreset("prev_month")}>Last Month</button>
                <button type="button" className="date-preset-btn" onClick={() => applyPreset("7d")}>Last 7D</button>
                <button type="button" className="date-preset-btn" onClick={() => applyPreset("14d")}>Last 14D</button>
                <button type="button" className={`date-preset-btn ${currentPreset === "all" ? "active" : ""}`} onClick={() => applyPreset("all")}>All Dates</button>
              </div>
            </div>

            {/* GOOGLE SHEETS TAB BAR */}
            <div className="sheets-tab-bar" role="tablist">
              <div className="sheets-tab-left-controls">
                <button
                  type="button"
                  className="sheets-icon-btn"
                  title="Add custom date range tab (+)"
                  aria-label="Add custom date range tab"
                  onClick={() => setAddTabOpen(true)}
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  className={`sheets-icon-btn ${allTabsOpen ? "active" : ""}`}
                  title="All sheets / date breakdown list (☰)"
                  aria-label="All sheets list"
                  onClick={() => setAllTabsOpen((prev) => !prev)}
                >
                  <Menu size={16} />
                </button>
                <div className="sheets-month-nav" title="Switch month">
                  <button
                    type="button"
                    className="sheets-icon-btn"
                    title={`Previous month (${formatMonthLabel(shiftMonth(selectedMonth, -1))})`}
                    aria-label="Previous month"
                    onClick={() => stepMonth(-1)}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <span className="sheets-month-label">{formatMonthLabel(selectedMonth)}</span>
                  <button
                    type="button"
                    className="sheets-icon-btn"
                    title={`Next month (${formatMonthLabel(shiftMonth(selectedMonth, 1))})`}
                    aria-label="Next month"
                    onClick={() => stepMonth(1)}
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
                <button
                  type="button"
                  className="sheets-icon-btn"
                  title="Scroll tabs towards left"
                  aria-label="Scroll tabs towards left"
                  onClick={() => tabsScrollRef.current?.scrollBy({ left: -260, behavior: "smooth" })}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  className="sheets-icon-btn"
                  title="Scroll tabs towards right"
                  aria-label="Scroll tabs towards right"
                  onClick={() => tabsScrollRef.current?.scrollBy({ left: 260, behavior: "smooth" })}
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div
                className="sheets-tabs-scroll"
                ref={tabsScrollRef}
                onWheel={(e) => {
                  if (e.deltaY !== 0 && !e.deltaX) {
                    e.currentTarget.scrollLeft += e.deltaY;
                  }
                }}
                onPointerDown={handleTabsPointerDown}
                onPointerMove={handleTabsPointerMove}
                onPointerUp={handleTabsPointerUp}
                onPointerLeave={handleTabsPointerUp}
              >
                {/* Dynamic Date Tabs for selected month */}
                {displayedTabs.map((tab) => {
                  const isActive = (confirmationFrom === tab.dateFrom && confirmationTo === tab.dateTo) || activeTabId === tab.id;
                  return (
                    <div key={tab.id} className="sheets-tab-item" style={{ display: "inline-flex", alignItems: "center", position: "relative", flexShrink: 0 }}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`sheets-sheet-tab ${isActive ? "active" : ""}`}
                        onClick={() => selectTab(tab.id, tab.dateFrom, tab.dateTo)}
                      >
                        <span>{tab.label}</span>
                        {tab.count > 0 && <span className="sheets-tab-badge">{tab.count}</span>}
                      </button>
                      <button
                        type="button"
                        className="sheets-tab-caret-btn"
                        aria-label={`${tab.label} menu`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setTabMenuOpen(tabMenuOpen === tab.id ? null : tab.id);
                        }}
                      >
                        <ChevronDown size={11} />
                      </button>
                    </div>
                  );
                })}

                {/* User Added Custom Tabs */}
                {customTabs.map((tab) => {
                  const isActive = (confirmationFrom === tab.dateFrom && confirmationTo === tab.dateTo) || activeTabId === tab.id;
                  return (
                    <div key={tab.id} className="sheets-tab-item" style={{ display: "inline-flex", alignItems: "center", position: "relative", flexShrink: 0 }}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`sheets-sheet-tab ${isActive ? "active" : ""}`}
                        onClick={() => selectTab(tab.id, tab.dateFrom, tab.dateTo)}
                      >
                        <span>{tab.label}</span>
                      </button>
                      <button
                        type="button"
                        className="sheets-tab-caret-btn"
                        aria-label={`${tab.label} menu`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setTabMenuOpen(tabMenuOpen === tab.id ? null : tab.id);
                        }}
                      >
                        <ChevronDown size={11} />
                      </button>
                      {tabMenuOpen === tab.id && (
                        <div
                          style={{
                            position: "absolute", top: "38px", left: "0", zIndex: 65,
                            background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                            borderRadius: "8px", padding: "4px", boxShadow: "0 8px 24px rgba(0,0,0,0.3)"
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => removeCustomTab(tab.id)}
                            style={{
                              display: "flex", alignItems: "center", gap: "6px", width: "100%",
                              padding: "6px 10px", border: 0, background: "transparent",
                              color: "hsl(var(--destructive))", fontSize: "11px", cursor: "pointer"
                            }}
                          >
                            <Trash2 size={13} /> Remove tab
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Active transient date range tab if user selected custom From-To range in toolbar */}
                {isCustomRangeActive && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={true}
                    className="sheets-sheet-tab active"
                    onClick={() => {}}
                  >
                    <span>{formatDateRangeLabel(confirmationFrom, confirmationTo)}</span>
                    <span className="sheets-tab-badge">{confirmationOrders.length}</span>
                    <span className="sheets-tab-caret"><ChevronDown size={11} /></span>
                  </button>
                )}

                {/* Switch Month Buttons in Tab Strip */}
                <button
                  type="button"
                  className="sheets-switch-month-btn"
                  title={`Switch to ${formatMonthLabel(shiftMonth(selectedMonth, -1))}`}
                  onClick={() => stepMonth(-1)}
                >
                  ‹ Older dates ({formatMonthLabel(shiftMonth(selectedMonth, -1))})
                </button>
                {shiftMonth(selectedMonth, 1) <= todayStr.slice(0, 7) && (
                  <button
                    type="button"
                    className="sheets-switch-month-btn"
                    title={`Switch to ${formatMonthLabel(shiftMonth(selectedMonth, 1))}`}
                    onClick={() => stepMonth(1)}
                  >
                    Newer dates ({formatMonthLabel(shiftMonth(selectedMonth, 1))}) ›
                  </button>
                )}
              </div>

              <div className="sheets-tab-right-controls">
                <button
                  type="button"
                  className="sheets-icon-btn"
                  title="Scroll left"
                  aria-label="Scroll tabs left"
                  onClick={() => tabsScrollRef.current?.scrollBy({ left: -220, behavior: "smooth" })}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  className="sheets-icon-btn"
                  title="Scroll right"
                  aria-label="Scroll tabs right"
                  onClick={() => tabsScrollRef.current?.scrollBy({ left: 220, behavior: "smooth" })}
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {/* ALL TABS POPOVER (☰) */}
              {allTabsOpen && (
                <div className="sheets-all-tabs-popover">
                  <div className="sheets-popover-header">
                    <strong>Sheet Tabs ({dateTabs.length + customTabs.length + 1})</strong>
                    <button type="button" className="sheets-icon-btn" onClick={() => setAllTabsOpen(false)}><X size={14} /></button>
                  </div>
                  <div className="sheets-popover-search">
                    <Search size={14} />
                    <input
                      type="search"
                      placeholder="Search date tabs…"
                      value={tabSearchQuery}
                      onChange={(e) => setTabSearchQuery(e.target.value)}
                    />
                  </div>
                  <div className="sheets-popover-list">
                    <button
                      type="button"
                      className={`sheets-popover-item ${(!confirmationFrom && !confirmationTo) || activeTabId === "all_dates" ? "active" : ""}`}
                      onClick={() => selectTab("all_dates", "", "")}
                    >
                      <span>All Dates (All Orders)</span>
                      <span className="sheets-tab-badge">{data.counts[mode] || 0}</span>
                    </button>
                    {dateTabs
                      .filter((t) => !tabSearchQuery || t.label.toLowerCase().includes(tabSearchQuery.toLowerCase()) || t.dateFrom.includes(tabSearchQuery))
                      .map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className={`sheets-popover-item ${confirmationFrom === tab.dateFrom && confirmationTo === tab.dateTo ? "active" : ""}`}
                          onClick={() => selectTab(tab.id, tab.dateFrom, tab.dateTo)}
                        >
                          <span>{tab.label}</span>
                          <span className="sheets-tab-badge">{tab.count}</span>
                        </button>
                      ))}
                    {customTabs
                      .filter((t) => !tabSearchQuery || t.label.toLowerCase().includes(tabSearchQuery.toLowerCase()))
                      .map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className={`sheets-popover-item ${confirmationFrom === tab.dateFrom && confirmationTo === tab.dateTo ? "active" : ""}`}
                          onClick={() => selectTab(tab.id, tab.dateFrom, tab.dateTo)}
                        >
                          <span>{tab.label}</span>
                          <span style={{ fontSize: "9px", color: "hsl(var(--muted-foreground))" }}>Custom</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SPREADSHEET VIEW (CSS Grid-Based Table with Pinned Actions) */}
          {viewLayout === "sheets" ? (
            <div className="sheets-table-wrap">
              {loading && confirmationOrders.length > 0 && (
                <div className="sheets-revalidating-bar" title="Updating orders in background..." />
              )}
              <div className="sheets-grid-table" role="table">
                {/* Header row */}
                <div className="sheets-grid-row sheets-grid-header" role="row">
                  <div className="sheets-grid-cell sheets-row-num" role="columnheader" aria-label="Row index">#</div>
                  <div className="sheets-grid-cell sheets-col-order" role="columnheader">Order</div>
                  <div className="sheets-grid-cell sheets-col-phone" role="columnheader">Phone</div>
                  <div className="sheets-grid-cell sheets-col-product" role="columnheader">Product description</div>
                  <div className="sheets-grid-cell sheets-col-status" role="columnheader">Status</div>
                  <div className="sheets-grid-cell sheets-col-payment" role="columnheader">Payment</div>
                  <div className="sheets-grid-cell sheets-col-attempts" role="columnheader">Call attempts</div>
                  <div className="sheets-grid-cell sheets-col-date" role="columnheader">{dateBasis === "allotted" ? "Allotted Date" : "Order Date"}</div>
                  <div className="sheets-grid-cell sheets-col-customer" role="columnheader">Customer & City</div>
                  <div className="sheets-grid-cell sheets-col-actions" role="columnheader" style={{ textAlign: "right" }}>Actions</div>
                </div>

                {/* Structured Skeleton or Data Rows */}
                {loading && confirmationOrders.length === 0 ? (
                  <ConfirmationTableSkeleton rowCount={8} />
                ) : confirmationOrders.length ? (
                  <div className="sheets-grid-body" role="rowgroup">
                    {confirmationOrders.map((order, idx) => {
                      const rowNumber = idx + 1;
                      const isCOD = String(order.paymentMethod || "").toUpperCase().includes("COD");
                      const dateVal = dateBasis === "allotted"
                        ? (order.assignedAt || order.orderDate || order.confirmationUpdatedAt || order.confirmedAt || order.rejectedAt)
                        : order.orderDate;
                      const latestAttempt = order.attempts?.at(-1);
                      return (
                        <div className="sheets-grid-row" role="row" key={order.id}>
                          <div className="sheets-grid-cell sheets-row-num" role="cell">{rowNumber}</div>
                          <div className="sheets-grid-cell sheets-col-order" role="cell">
                            <strong>#{order.channelOrderId}</strong>
                            <small style={{ color: "hsl(var(--muted-foreground))", display: "block", fontSize: "10.5px" }}>₹{Number(order.total || 0).toLocaleString("en-IN")}</small>
                          </div>
                          <div className="sheets-grid-cell sheets-col-phone" role="cell">
                            {phoneColumn(order)}
                          </div>
                          <div className="sheets-grid-cell sheets-col-product" role="cell" style={{ maxWidth: "260px" }}>
                            <p style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11.5px", color: "hsl(var(--foreground))" }} title={productSummary(order.products)}>
                              {productSummary(order.products)}
                            </p>
                          </div>
                          <div className="sheets-grid-cell sheets-col-status" role="cell">
                            <span className="workflow-status ready" style={{ fontSize: "10.5px" }}>{order.status || "New"}</span>
                          </div>
                          <div className="sheets-grid-cell sheets-col-payment" role="cell">
                            <span className={`sheets-badge-pill ${isCOD ? "sheets-badge-cod" : "sheets-badge-prepaid"}`}>
                              {order.paymentMethod || "COD"} <ChevronDown size={10} />
                            </span>
                          </div>
                          <div className="sheets-grid-cell sheets-col-attempts" role="cell">
                            {order.confirmationStatus === "confirmed" ? (
                              <span className="sheets-badge-pill sheets-badge-attempt success">✓ Confirmed</span>
                            ) : order.confirmationStatus === "rejected" ? (
                              <span className="sheets-badge-pill sheets-badge-attempt">✕ Rejected</span>
                            ) : order.attempts?.length > 0 ? (
                              <span className="sheets-badge-pill sheets-badge-attempt" title={latestAttempt ? `${latestAttempt.outcome}: ${latestAttempt.note}` : ""}>
                                {order.attempts.length === 1 ? "1st Att..." : order.attempts.length === 2 ? "2nd Att..." : `${order.attempts.length}rd Att...`} <ChevronDown size={10} />
                              </span>
                            ) : (
                              <span className="sheets-badge-pill" style={{ opacity: 0.65 }}>Pending</span>
                            )}
                          </div>
                          <div className="sheets-grid-cell sheets-col-date" role="cell">
                            <span style={{ fontSize: "11.5px", fontWeight: 500 }}>{when(dateVal)}</span>
                          </div>
                          <div className="sheets-grid-cell sheets-col-customer" role="cell">
                            <strong>{order.customerName || "Customer"}</strong>
                            <small style={{ color: "hsl(var(--muted-foreground))", display: "block", fontSize: "10.5px" }}>
                              {[order.customerCity, order.customerState].filter(Boolean).join(", ") || "—"}
                            </small>
                          </div>
                          <div className="sheets-grid-cell sheets-col-actions" role="cell">
                            {mode === "queue" ? (
                              <div className="confirmation-actions" style={{ justifyContent: "flex-end", gap: "6px" }}>
                                <button className="confirmation-accept" onClick={() => openAction(order, "confirm")}>Accept</button>
                                <button className="confirmation-reject" onClick={() => openAction(order, "reject")}>Reject</button>
                                <button className="confirmation-icon" title="Schedule callback" aria-label={`Schedule callback for ${order.channelOrderId}`} onClick={() => openAction(order, "callback")}><PhoneCall size={15} /></button>
                                <button className="confirmation-icon" title="No answer" aria-label={`Record no answer for ${order.channelOrderId}`} onClick={() => openAction(order, "unreachable")}><PhoneMissed size={15} /></button>
                              </div>
                            ) : mode === "confirmed" ? (
                              fulfillmentBadge(order, openDelayLogs)
                            ) : (
                              <div className="manual-cancel-badge">Cancel in Shiprocket</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="sheets-grid-empty" style={{ textAlign: "center", padding: "48px 20px", color: "hsl(var(--muted-foreground))" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "20px" }}>✓</span>
                      <strong>No confirmation orders match this date or filter</strong>
                      <p style={{ margin: 0, fontSize: "11.5px" }}>Switch to another date tab or select &ldquo;All Dates&rdquo; to view all orders.</p>
                    </div>
                  </div>
                )}
              </div>
              {data.hasMore && (
                <div className="lazy-load-footer">
                  <div className="lazy-load-text">
                    Showing <strong>{(data[mode] || []).length}</strong> of <strong>{data.total ?? (data[mode] || []).length}</strong> orders (loaded in 400-order batches to keep database &amp; UI blazing fast)
                  </div>
                  <button
                    type="button"
                    className="lazy-load-btn"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "Loading Next 400..." : `Load Next 400 Orders (${(data.total ?? (data[mode] || []).length) - (data[mode] || []).length} remaining)`}
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* CARDS VIEW (Prehistoric layout with pinned actions column and horizontal scroll) */
            <div className="confirmation-orders">
              <div className="confirmation-card-header-row">
                <div>Order details</div>
                <div>Customer & Address</div>
                <div>Contact</div>
                <div>Shopify Tags</div>
                <div>Assignment & Recall</div>
                <div className="confirmation-actions-header">Actions</div>
              </div>
              {confirmationOrders.length ? (
                confirmationOrders.map((order) => {
                  const latest = [...order.attempts].reverse()[0];
                  return (
                    <div className={`confirmation-order ${mode === "confirmed" ? "confirmed-order" : mode === "rejected" ? "rejected-order" : ""}`} key={order.id}>
                      <div className="confirmation-order-main">
                        <strong>#{order.channelOrderId}</strong>
                        <small>
                          {mode === "confirmed" ? `Confirmed ${when(order.confirmedAt)}` : mode === "rejected" ? `Rejected ${when(order.rejectedAt)}` : `${when(order.orderDate)} · ${order.paymentMethod || "Payment unknown"} · ₹${Number(order.total || 0).toLocaleString("en-IN")}`}
                        </small>
                        <p>{productSummary(order.products)}</p>
                      </div>
                      <div className="confirmation-customer">
                        <strong>{order.customerName || "Customer"}</strong>
                        <small>{[order.customerAddress, order.customerCity, order.customerState, order.customerPincode].filter(Boolean).join(", ") || "No address"}</small>
                      </div>
                      {phoneColumn(order)}
                      {confirmationTags(order)}
                      <div className="confirmation-meta">
                        <span>{order.campaignName || "Confirmation"}</span>
                        {mode === "queue" ? (
                          isAdmin ? (
                            <label className="confirmation-agent-select">
                              Agent
                              <select value={order.confirmationAssigneeId || ""} disabled={busy} onChange={(event) => void post({ action: "assign_confirmation_agent", orderId: order.id, agentId: event.target.value })}>
                                <option value="">Unassigned</option>
                                {data.agents.map((agent) => <option key={agent.userId} value={agent.userId}>{agent.name}</option>)}
                              </select>
                            </label>
                          ) : (
                            <small>{order.confirmationAssigneeName ? `Assigned to ${order.confirmationAssigneeName}` : "Unassigned"}</small>
                          )
                        ) : (
                          <small>{latest?.note || latest?.rejectionReason?.replaceAll("_", " ") || "No notes"}</small>
                        )}
                        {mode === "queue" && <small>{order.attempts.length}/3 recall attempts</small>}
                      </div>
                      <div className="confirmation-actions-pinned">
                        {mode === "queue" ? (
                          <div className="confirmation-actions">
                            <div className="confirmation-primary-actions">
                              <button className="confirmation-accept" onClick={() => openAction(order, "confirm")}>Accept</button>
                              <button className="confirmation-reject" onClick={() => openAction(order, "reject")}>Reject</button>
                            </div>
                            <button className="confirmation-icon" title="Schedule callback" aria-label={`Schedule callback for ${order.channelOrderId}`} onClick={() => openAction(order, "callback")}><PhoneCall size={17} /></button>
                            <button className="confirmation-icon" title="No answer" aria-label={`Record no answer for ${order.channelOrderId}`} onClick={() => openAction(order, "unreachable")}><PhoneMissed size={17} /></button>
                          </div>
                        ) : mode === "confirmed" ? (
                          fulfillmentBadge(order, openDelayLogs)
                        ) : (
                          <div className="manual-cancel-badge">Cancel manually in Shiprocket</div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="confirmation-empty">
                  <span>✓</span>
                  <h3>No orders match this date</h3>
                  <p>Select another date tab or select &ldquo;All Dates&rdquo; to see all orders.</p>
                </div>
              )}
              {data.hasMore && (
                <div className="lazy-load-footer">
                  <div className="lazy-load-text">
                    Showing <strong>{(data[mode] || []).length}</strong> of <strong>{data.total ?? (data[mode] || []).length}</strong> orders (loaded in 400-order batches to keep database &amp; UI blazing fast)
                  </div>
                  <button
                    type="button"
                    className="lazy-load-btn"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "Loading Next 400..." : `Load Next 400 Orders (${(data.total ?? (data[mode] || []).length) - (data[mode] || []).length} remaining)`}
                  </button>
                </div>
              )}
            </div>
          )}
        </article>
        </>
      )}

      {/* CAMPAIGNS SECTION */}
      {!loading && section === "campaigns" && (
        <div className="campaign-layout">
          <article className="confirmation-card campaign-panel">
            <header className="confirmation-header campaign-panel-header">
              <div>
                <p className="eyebrow">CAMPAIGN PRIORITY</p>
                <h2>Campaign assignment</h2>
                <p>Automatic routing adds matching orders. Pausing it keeps existing assignments; create a manual campaign to select orders yourself.</p>
              </div>
              <button className="campaign-create" onClick={() => setCreateOpen(true)}>New campaign</button>
            </header>
            <div className="campaign-list">
              {data.campaigns.map((campaign, index) => (
                <div
                  className={`campaign-row ${campaign.isActive ? "" : "inactive"} ${draggedCampaignId === campaign.id ? "dragging" : ""}`}
                  key={campaign.id}
                  ref={(element) => { if (element) campaignElements.current.set(campaign.id, element); else campaignElements.current.delete(campaign.id); }}
                  onDragOver={(event) => { event.preventDefault(); }}
                  onDragEnter={() => previewCampaign(campaign.id)}
                  onDrop={() => void dropCampaign()}
                >
                  <div
                    className="campaign-drag-handle"
                    role="button"
                    tabIndex={0}
                    draggable={!busy}
                    aria-label={`Move ${campaign.name}. Priority ${index + 1}`}
                    title="Drag to change priority"
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", campaign.id);
                      dragOriginal.current = [...data.campaigns];
                      const card = event.currentTarget.closest(".campaign-row");
                      if (card) event.dataTransfer.setDragImage(card, 30, 30);
                      setDraggedCampaignId(campaign.id);
                    }}
                    onDragEnd={() => {
                      if (dragOriginal.current.length) setData((current) => ({ ...current, campaigns: dragOriginal.current }));
                      setDraggedCampaignId("");
                    }}
                    onKeyDown={(event) => {
                      if (busy) return;
                      if (["ArrowUp", "ArrowDown"].includes(event.key)) event.preventDefault();
                      if (event.key === "ArrowUp") void moveCampaign(index, -1);
                      if (event.key === "ArrowDown") void moveCampaign(index, 1);
                    }}
                  >
                    <GripVertical size={18} />
                  </div>
                  <div className="campaign-copy">
                    <div className="campaign-title"><strong>{campaign.name}</strong></div>
                    <p>{campaign.description || "No description"}</p>
                    {(campaign.criteria.tags?.length || campaign.criteria.dateFrom || campaign.criteria.dateTo) && (
                      <small>
                        {campaign.criteria.tags?.length ? `Tags: ${campaign.criteria.tags.join(", ")}` : ""}
                        {campaign.criteria.tags?.length && (campaign.criteria.dateFrom || campaign.criteria.dateTo) ? " · " : ""}
                        {campaign.criteria.dateFrom || campaign.criteria.dateTo ? `${campaign.criteria.dateFrom || "Any date"} to ${campaign.criteria.dateTo || "Any date"}` : ""}
                      </small>
                    )}
                  </div>
                  <div className="campaign-row-meta">
                    <span className="priority-badge">Priority {index + 1}</span>
                    <span>{Number(campaign.orderCount)} orders</span>
                    <span className="campaign-agent"><UsersRound size={15} />{campaign.autoAssign ? "Automatic routing" : "Manual selection"}</span>
                  </div>
                  <div className="campaign-more-wrap">
                    <button className="campaign-more" type="button" aria-label={`Actions for ${campaign.name}`} onClick={() => setOpenCampaignMenu((current) => current === campaign.id ? "" : campaign.id)}>
                      <MoreHorizontal size={18} />
                    </button>
                    {openCampaignMenu === campaign.id && (
                      <div className="campaign-menu">
                        {!campaign.isActive ? (
                          <span>Campaign inactive</span>
                        ) : (
                          <>
                            {campaign.id === "cmp_default_high_rto" && (
                              <button disabled={busy} type="button" onClick={() => { setOpenCampaignMenu(""); void post({ action: "set_campaign_routing", campaignId: campaign.id, autoAssign: !campaign.autoAssign }); }}>
                                {campaign.autoAssign ? "Pause automatic routing" : "Resume automatic routing"}
                              </button>
                            )}
                            <button disabled={busy} type="button" onClick={() => { setOpenCampaignMenu(""); void post({ action: "deactivate_campaign", campaignId: campaign.id }); }}>
                              Deactivate
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      )}

      {/* MODAL: ADD CUSTOM DATE TAB (+) */}
      <Modal title="Add Date Range Tab" open={addTabOpen} onClose={() => setAddTabOpen(false)} busy={busy}>
        <form onSubmit={handleAddCustomTab} style={{ display: "grid", gap: "14px", padding: "10px 0" }}>
          <p style={{ margin: 0, fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>
            Create a switchable tab for any custom date range (e.g. &ldquo;11- 19 July&rdquo;, &ldquo;Final Call&rdquo;).
          </p>
          <label style={{ display: "grid", gap: "5px", fontSize: "11px", fontWeight: 600 }}>
            Tab Name (optional)
            <input
              type="text"
              placeholder="e.g. 11- 19 July, Batch 2"
              value={newTabTitle}
              onChange={(e) => setNewTabTitle(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <label style={{ display: "grid", gap: "5px", fontSize: "11px", fontWeight: 600 }}>
              From Date
              <input
                required
                type="date"
                value={newTabFrom}
                max={newTabTo ? (newTabTo < todayStr ? newTabTo : todayStr) : todayStr}
                onChange={(e) => setNewTabFrom(e.target.value > todayStr ? todayStr : e.target.value)}
                style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
              />
            </label>
            <label style={{ display: "grid", gap: "5px", fontSize: "11px", fontWeight: 600 }}>
              To Date
              <input
                required
                type="date"
                value={newTabTo}
                max={todayStr}
                min={newTabFrom || undefined}
                onChange={(e) => setNewTabTo(e.target.value > todayStr ? todayStr : e.target.value)}
                style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
              />
            </label>
          </div>
          <footer style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" }}>
            <button type="button" onClick={() => setAddTabOpen(false)} style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "transparent", color: "hsl(var(--foreground))", cursor: "pointer" }}>
              Cancel
            </button>
            <button type="submit" style={{ padding: "8px 16px", borderRadius: "8px", border: 0, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", fontWeight: 700, cursor: "pointer" }}>
              Add Sheet Tab
            </button>
          </footer>
        </form>
      </Modal>

      {/* MODAL: CREATE CAMPAIGN */}
      <Modal title="Create campaign" open={createOpen} onClose={() => setCreateOpen(false)} busy={busy} wide>
        <form className="campaign-workflow" onSubmit={createCampaign}>
          <section className="workflow-panel workflow-section">
            <div className="workflow-details-grid">
              <label>Campaign name<input required value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="e.g. B2G1 verification" /></label>
              <label>Description<input value={campaignDescription} onChange={(event) => setCampaignDescription(event.target.value)} placeholder="Optional context" /></label>
            </div>
          </section>
          <section className="workflow-panel workflow-section">
            <div className="workflow-filter-grid">
              <label>From date<input type="date" value={campaignDateFrom} max={campaignDateTo || undefined} onChange={(event) => setCampaignDateFrom(event.target.value)} /></label>
              <label>To date<input type="date" value={campaignDateTo} min={campaignDateFrom || undefined} onChange={(event) => setCampaignDateTo(event.target.value)} /></label>
              <label>Payment<select value={campaignPayment} onChange={(event) => setCampaignPayment(event.target.value)}><option value="all">All payments</option><option value="cod">COD</option><option value="prepaid">Prepaid</option></select></label>
              <label className="workflow-toggle" htmlFor="campaign-auto-assign">
                <input id="campaign-auto-assign" type="checkbox" checked={autoAssign} onChange={(event) => setAutoAssign(event.target.checked)} />
                <span aria-hidden="true"><i /></span>
                <strong>Auto-assign <small>Include future matching orders</small></strong>
              </label>
            </div>
            <fieldset className="campaign-tags">
              <legend>Order tags <span>{selectedTags.size ? `${selectedTags.size} selected · ` : ""}All selected tags must be present</span></legend>
              <div className="campaign-tag-options">
                {data.availableTags.map((tag) => {
                  const selected = selectedTags.has(tag);
                  return (
                    <label className={selected ? "selected" : ""} key={tag}>
                      <input type="checkbox" checked={selected} onChange={(event) => setSelectedTags((current) => { const next = new Set(current); if (event.target.checked) next.add(tag); else next.delete(tag); return next; })} />
                      <span className="campaign-tag-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                      <strong>{tag}</strong>
                    </label>
                  );
                })}
              </div>
              {!data.availableTags.length && <p>No order tags are available yet.</p>}
              {selectedTags.size > 0 && <button className="campaign-tags-clear" type="button" onClick={() => setSelectedTags(new Set())}>Clear selected tags</button>}
            </fieldset>
          </section>
          <section className="workflow-panel workflow-orders">
            <div className="candidate-heading">
              <div><strong>Select current orders <small>{candidates.length} matching</small></strong></div>
              <label className="workflow-search"><Search size={16} /><input value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Search order, customer or phone" /></label>
              <button type="button" onClick={() => setSelectedCandidates(new Set(candidates.map((order) => order.id)))}>Select matching</button>
            </div>
            <div className="workflow-table-wrap">
              <table className="workflow-table">
                <thead><tr><th aria-label="Select order" /><th>Order</th><th>Customer</th><th>Payment</th><th>Order date</th><th>Tags</th><th>Status</th></tr></thead>
                <tbody>
                  {candidates.map((order) => (
                    <tr key={order.id}>
                      <td><input aria-label={`Select order ${order.channelOrderId}`} type="checkbox" checked={selectedCandidates.has(order.id)} onChange={(event) => setSelectedCandidates((current) => { const next = new Set(current); if (event.target.checked) next.add(order.id); else next.delete(order.id); return next; })} /></td>
                      <td><strong>#{order.channelOrderId}</strong></td>
                      <td><strong>{order.customerName || "Customer"}</strong><small>{order.customerPhone || "No phone"}</small></td>
                      <td><span className={`workflow-status ${order.paymentMethod?.toLowerCase() === "cod" ? "cod" : "prepaid"}`}>{order.paymentMethod || "Unknown"}</span></td>
                      <td>{when(order.orderDate)}</td>
                      <td><div className="workflow-tag-list">{order.tags.length ? order.tags.map((tag) => <span key={tag}>{tag}</span>) : <small>No tags</small>}</div></td>
                      <td><span className="workflow-status ready">{order.confirmationStatus || "Ready"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!candidates.length && <div className="workflow-empty">No orders match the current filters.</div>}
            </div>
          </section>
          <footer className="workflow-panel workflow-submit">
            <div><CheckCircle2 size={18} /><span><strong>{selectedCandidates.size} orders selected</strong><small>{autoAssign ? "Future matching orders will be added automatically." : "Only selected current orders will be assigned."}</small></span></div>
            <div>
              <button type="button" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button className="workflow-submit-button" disabled={busy} type="submit">{busy ? "Creating…" : "Create campaign"}</button>
            </div>
          </footer>
        </form>
      </Modal>

      {/* MODAL: ORDER CONFIRMATION / CALL ACTION */}
      <Modal title="Order confirmation" open={!!selectedOrder} onClose={() => setSelectedOrder(null)} busy={busy}>
        {selectedOrder && (
          <form className="confirmation-action-form" onSubmit={submitOrderAction}>
            <header>
              <div>
                <p className="eyebrow">ORDER #{selectedOrder.channelOrderId}</p>
                <h2>
                  {orderAction === "confirm" ? "Confirm customer order" : orderAction === "reject" ? "Reject confirmation" : orderAction === "callback" ? "Schedule callback" : "Record no answer"}
                </h2>
              </div>
            </header>
            {orderAction === "reject" && <div className="manual-warning"><strong>Dashboard record only</strong><span>You must cancel this order manually in Shiprocket.</span></div>}
            {orderAction === "callback" && <label>Callback time<input required type="datetime-local" value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)} /></label>}
            {orderAction === "reject" && (
              <label>
                Reason
                <select value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)}>
                  <option value="customer_cancelled">Customer cancelled</option>
                  <option value="duplicate_order">Duplicate order</option>
                  <option value="incorrect_details">Incorrect details</option>
                  <option value="customer_unreachable">Customer unreachable</option>
                  <option value="other">Other</option>
                </select>
              </label>
            )}
            <label>Call note<textarea required value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record what the customer said and any useful context" rows={4} /></label>
            <footer>
              <button type="button" onClick={() => setSelectedOrder(null)}>Cancel</button>
              <button className={orderAction === "reject" ? "danger" : "positive"} disabled={busy} type="submit">
                {busy ? "Saving…" : orderAction === "confirm" ? "Mark approved" : orderAction === "reject" ? "Add to rejected" : "Save attempt"}
              </button>
            </footer>
          </form>
        )}
      </Modal>

      {/* MANDATORY DELAY REASON MODAL (UNCLOSEABLE, NATIVE TOP-LAYER POPUP) */}
      <MandatoryDelayDialog
        order={activeDelayedOrder}
        submitting={delaySubmitting}
        onSubmit={handleDelaySubmit}
      />

      {/* DELAY LOGS AUDIT TRAIL MODAL (CLICKABLE FROM DELAY PILL) */}
      <Modal
        title={`Delay Reason History — #${inspectingDelayOrder?.channelOrderId || ""}`}
        open={!!inspectingDelayOrder}
        onClose={() => setInspectingDelayOrder(null)}
        wide
      >
        {inspectingDelayOrder && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ margin: 0, fontSize: "13px", color: "hsl(var(--muted-foreground))" }}>
              Permanent audit log of all delay justifications submitted for confirmed order <strong>#{inspectingDelayOrder.channelOrderId}</strong>.
            </p>

            {inspectingLogsLoading ? (
              <div style={{ padding: "30px", textAlign: "center", color: "hsl(var(--muted-foreground))" }}>
                Loading audit trail…
              </div>
            ) : inspectingLogs.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", background: "hsl(var(--muted) / 0.3)", borderRadius: "8px" }}>
                No delay entries recorded yet for this order.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="delay-logs-table">
                  <thead>
                    <tr>
                      <th>Logged At</th>
                      <th>Reason</th>
                      <th>Hours Delayed</th>
                      <th>Notes / Action Plan</th>
                      <th>Logged By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspectingLogs.map((log) => (
                      <tr key={log.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{when(log.createdAt)}</td>
                        <td>
                          <span className="delay-reason-pill">{log.reasonText}</span>
                        </td>
                        <td>{Math.round(log.hoursDelayed)}h</td>
                        <td>{log.notes || "—"}</td>
                        <td>
                          <strong>{log.actorName || "Admin"}</strong>
                          {log.actorRole && <small style={{ display: "block", color: "hsl(var(--muted-foreground))" }}>({log.actorRole})</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
              <button
                type="button"
                onClick={() => setInspectingDelayOrder(null)}
                style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "transparent", color: "hsl(var(--foreground))", cursor: "pointer" }}
              >
                Close History
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
