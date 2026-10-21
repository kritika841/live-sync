"use client";

import React, { useMemo, useState } from "react";

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  /** one value per x label; null leaves a gap-free interpolation skip */
  values: Array<number | null>;
  fill?: boolean;
}

interface TrendLineChartProps {
  labels: string[];
  series: TrendSeries[];
  height?: number;
  unit?: string;
  /** fixed y max (e.g. 100 for percentages); auto if omitted */
  yMax?: number;
  formatLabel?: (label: string) => string;
}

/** Monotone cubic path so the line is smooth and never overshoots the data. */
function smoothPath(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  const n = points.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1][0] - points[i][0]);
    m.push((points[i + 1][1] - points[i][1]) / (dx[i] || 1));
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = points[i][0] + dx[i] / 3;
    const c1y = points[i][1] + (t[i] * dx[i]) / 3;
    const c2x = points[i + 1][0] - dx[i] / 3;
    const c2y = points[i + 1][1] - (t[i + 1] * dx[i]) / 3;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${points[i + 1][0]} ${points[i + 1][1]}`;
  }
  return d;
}

export function TrendLineChart({ labels, series, height = 220, unit = "%", yMax, formatLabel }: TrendLineChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const W = 800;
  const pad = { l: 40, r: 14, t: 12, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const visible = series.filter((s) => !hidden.has(s.key));
  const max = useMemo(() => {
    if (yMax) return yMax;
    const all = visible.flatMap((s) => s.values.filter((v): v is number => v != null));
    const top = Math.max(1, ...all);
    const step = top <= 10 ? 2 : top <= 50 ? 10 : 20;
    return Math.ceil(top / step) * step;
  }, [visible, yMax]);

  const xAt = (i: number) => pad.l + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const yAt = (v: number) => pad.t + innerH - (Math.min(v, max) / max) * innerH;
  const fmt = formatLabel || ((l: string) => l);
  const tickEvery = Math.max(1, Math.ceil(labels.length / 8));

  if (labels.length === 0) {
    return <div className="py-10 text-center text-xs text-muted-foreground">No data for this period.</div>;
  }

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setHidden((cur) => { const next = new Set(cur); if (next.has(s.key)) next.delete(s.key); else next.add(s.key); return next; })}
            className={`flex items-center gap-1.5 text-[11px] font-semibold transition ${hidden.has(s.key) ? "opacity-40" : ""}`}
          >
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color, height: 3 }} />
            {s.label}
          </button>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        role="img"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          const idx = Math.round(((x - pad.l) / innerW) * (labels.length - 1));
          setHover(Math.max(0, Math.min(labels.length - 1, idx)));
        }}
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`trend-fill-${s.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = pad.t + innerH - f * innerH;
          return (
            <g key={f}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.1" />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.55">
                {Math.round(max * f)}{unit}
              </text>
            </g>
          );
        })}
        {labels.map((l, i) =>
          i % tickEvery === 0 || i === labels.length - 1 ? (
            <text key={l + i} x={xAt(i)} y={height - 8} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.55">
              {fmt(l)}
            </text>
          ) : null,
        )}
        {visible.map((s) => {
          const pts = s.values
            .map((v, i) => (v == null ? null : ([xAt(i), yAt(v)] as [number, number])))
            .filter((p): p is [number, number] => p !== null);
          if (!pts.length) return null;
          const line = smoothPath(pts);
          const area = `${line} L ${pts[pts.length - 1][0]} ${pad.t + innerH} L ${pts[0][0]} ${pad.t + innerH} Z`;
          return (
            <g key={s.key}>
              {s.fill !== false && <path d={area} fill={`url(#trend-fill-${s.key})`} />}
              <path d={line} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
              {labels.length <= 14 && pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={s.color} />)}
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.t} y2={pad.t + innerH} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="3 3" />
            {visible.map((s) => {
              const v = s.values[hover];
              return v == null ? null : <circle key={s.key} cx={xAt(hover)} cy={yAt(v)} r="4.5" fill={s.color} stroke="white" strokeWidth="1.5" />;
            })}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-[11px]">
          <strong className="text-foreground">{fmt(labels[hover])}</strong>
          {visible.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
              {s.label}: <strong className="text-foreground">{s.values[hover] == null ? "—" : `${s.values[hover]}${unit}`}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
