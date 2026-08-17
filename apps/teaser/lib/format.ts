export const fmt = (n: number): string => n.toLocaleString("en-US");

/** 12400 -> "12.4k", 2400000 -> "2.4m" */
export const compact = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`
      : `${n}`;

/** seconds -> "51s" / "4m" / "2h" */
export const duration = (s: number): string =>
  s < 90 ? `${Math.round(s)}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;

/** ms remaining -> "11h 23m" / "43m" / "gone" */
export const remaining = (ms: number): string => {
  if (ms <= 0) return "gone";
  const m = Math.floor(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
