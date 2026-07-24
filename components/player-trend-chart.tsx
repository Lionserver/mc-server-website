"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";

type TrendChartPoint = {
  timestamp: number;
  date: string;
  players: number;
  capacityRate: number;
  source: "bridge" | "ping" | "mixed";
  delta: number | null;
  isPeak: boolean;
  isLow: boolean;
  isCurrent: boolean;
};

type Props = {
  points: TrendChartPoint[];
  yAxisMax: number;
  averagePlayers: number;
  serverId: string;
};

const number = new Intl.NumberFormat("ko-KR");
const formatPlayers = (value: number) => number.format(value);

export function PlayerTrendChart({ points, yAxisMax, averagePlayers, serverId }: Props) {
  const [animationEnabled, setAnimationEnabled] = useState(false);
  const gradientId = `player-trend-${serverId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const currentPoint = points.at(-1);
  const peakPoint = points.reduce<TrendChartPoint | undefined>((peak, point) => !peak || point.players > peak.players ? point : peak, undefined);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAnimationEnabled(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  return <div className="trend-chart-frame" aria-label={`최근 14일 접속자 5분 기록 ${points.length}개`}>
    <AreaChart data={points} width="100%" height="100%" responsive accessibilityLayer margin={{ top: 22, right: 16, bottom: 2, left: 0 }}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent-bright)" stopOpacity={0.38} /><stop offset="70%" stopColor="var(--accent)" stopOpacity={0.1} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
      <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 5" />
      <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickCount={7} axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 7, fontFamily: "ui-monospace, monospace" }} tickFormatter={formatTrendAxis} tickMargin={10} minTickGap={22} />
      <YAxis width={42} domain={[0, yAxisMax]} tickCount={5} allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 7, fontFamily: "ui-monospace, monospace" }} tickFormatter={formatPlayers} />
      <Tooltip content={<TrendChartTooltip />} cursor={{ stroke: "var(--accent)", strokeWidth: 1, strokeDasharray: "3 3" }} animationDuration={animationEnabled ? 120 : 0} wrapperStyle={{ outline: "none" }} />
      <ReferenceLine y={averagePlayers} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: `AVG ${formatPlayers(averagePlayers)}`, position: "insideTopRight", fill: "var(--muted)", fontSize: 7 }} />
      <Area type="monotoneX" dataKey="players" name="접속자" stroke="var(--accent-bright)" strokeWidth={2.5} fill={`url(#${gradientId})`} dot={points.length <= 96 ? { r: 2.5, fill: "var(--surface)", stroke: "var(--accent)", strokeWidth: 2 } : false} activeDot={{ r: 5, fill: "var(--surface)", stroke: "var(--accent-bright)", strokeWidth: 2 }} isAnimationActive={animationEnabled} animationDuration={520} />
      {peakPoint && peakPoint.timestamp !== currentPoint?.timestamp && <ReferenceDot x={peakPoint.timestamp} y={peakPoint.players} r={4} fill="var(--surface)" stroke="var(--ink)" strokeWidth={2} />}
      {currentPoint && <ReferenceDot x={currentPoint.timestamp} y={currentPoint.players} r={4.5} fill="var(--accent-bright)" stroke="var(--surface)" strokeWidth={2} />}
    </AreaChart>
  </div>;
}

function TrendChartTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as TrendChartPoint | undefined;
  if (!point) return null;
  const source = point.source === "bridge" ? "브리지 실측" : point.source === "mixed" ? "브리지 + 공개 핑" : "공개 핑";
  return <div className="trend-tooltip" role="status">
    <div><span>{point.date}{point.isCurrent ? " · 최신" : point.isPeak ? " · 최고" : point.isLow ? " · 최저" : ""}</span><b>{formatPlayers(point.players)}명</b></div>
    <div className={point.delta !== null && point.delta < 0 ? "trend-delta down" : "trend-delta"}><span>전일 대비</span><strong>{point.delta === null ? "수집 시작" : `${point.delta >= 0 ? "+" : ""}${formatPlayers(point.delta)}명`}</strong></div>
    <small>정원 대비 {point.capacityRate}%</small><em>{source}</em>
  </div>;
}

function formatTrendAxis(timestamp: number) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}
