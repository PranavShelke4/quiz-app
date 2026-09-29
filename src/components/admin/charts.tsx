"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PRIMARY = "oklch(0.47 0.2 272)";
const MUTED = "oklch(0.72 0.02 264)";
const GRID = "oklch(0.92 0.006 264)";
const axis = { fontSize: 12, fill: "oklch(0.5 0.02 264)" };

function Frame({ children, height = 260, label }: { children: React.ReactElement; height?: number; label: string }) {
  return (
    <div role="img" aria-label={label} style={{ width: "100%", height }}>
      <ResponsiveContainer>{children}</ResponsiveContainer>
    </div>
  );
}

const tooltipStyle = { borderRadius: 8, border: "1px solid oklch(0.915 0.006 264)", fontSize: 12 };

export function ParticipationChart({ data }: { data: { day: number; answered: number; missed: number; participation: number }[] }) {
  return (
    <Frame label="Participation by day">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} tickFormatter={(d) => `D${d}`} />
        <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => `Day ${d}`} />
        <Bar dataKey="answered" name="Answered" stackId="a" fill={PRIMARY} radius={[0, 0, 0, 0]} />
        <Bar dataKey="missed" name="Missed" stackId="a" fill={MUTED} radius={[4, 4, 0, 0]} />
      </BarChart>
    </Frame>
  );
}

export function PercentLineChart({ data, label }: { data: { day: number; participation: number }[]; label: string }) {
  return (
    <Frame label={label}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} tickFormatter={(d) => `D${d}`} />
        <YAxis tick={axis} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => `Day ${d}`} formatter={(v) => [`${v}%`, "Participation"]} />
        <Area type="monotone" dataKey="participation" stroke={PRIMARY} fill={PRIMARY} fillOpacity={0.12} strokeWidth={2} />
      </AreaChart>
    </Frame>
  );
}

export function RegistrationChart({ data }: { data: { date: string; newUsers: number; totalUsers: number }[] }) {
  return (
    <Frame label="Registration growth">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
        <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="totalUsers" name="Total users" stroke={PRIMARY} fill={PRIMARY} fillOpacity={0.12} strokeWidth={2} />
      </AreaChart>
    </Frame>
  );
}

export function SimpleBarChart({
  data,
  xKey,
  yKey,
  label,
  unit,
  height,
}: {
  data: Record<string, string | number>[];
  xKey: string;
  yKey: string;
  label: string;
  unit?: string;
  height?: number;
}) {
  return (
    <Frame label={label} height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={false} />
        <YAxis tick={axis} tickLine={false} axisLine={false} unit={unit} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey={yKey} fill={PRIMARY} radius={[4, 4, 0, 0]} />
      </BarChart>
    </Frame>
  );
}
