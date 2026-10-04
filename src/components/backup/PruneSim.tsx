"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Button, Panel, Toggle } from "@/components/ui";

type Opt = "last" | "daily" | "weekly" | "monthly" | "yearly";
const OPTS: Opt[] = ["last", "daily", "weekly", "monthly", "yearly"];
const COLOR: Record<Opt, string> = {
  last: "var(--color-f1)",
  daily: "var(--color-f2)",
  weekly: "var(--color-f3)",
  monthly: "var(--color-f4)",
  yearly: "var(--color-f5)",
};

const TODAY = Date.UTC(2026, 9, 4); // 2026-10-04
const DAY = 86400000;
const DAYS = 371; // 53 weeks

type Backup = { t: number; mark?: Opt | "remove" };

function isoWeek(t: number) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const firstThu = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thursday.getTime() - firstThu.getTime()) / DAY - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${thursday.getUTCFullYear()}/${week}`;
}

const SELECT: Record<Opt, (t: number) => string> = {
  last: (t) => String(t),
  daily: (t) => new Date(t).toISOString().slice(0, 10),
  weekly: isoWeek,
  monthly: (t) => new Date(t).toISOString().slice(0, 7),
  yearly: (t) => new Date(t).toISOString().slice(0, 4),
};

/** Same algorithm as proxmox-backup's prune: options are applied in order, each keeps the newest backup of
 *  up to N periods that no previously kept backup already covers. Everything left unmarked is removed. */
function prune(list: Backup[], keep: Record<Opt, number>) {
  const sorted = [...list].sort((a, b) => b.t - a.t).map((b) => ({ ...b, mark: undefined as Backup["mark"] }));
  if (OPTS.every((o) => !keep[o])) return sorted.map((b) => ({ ...b, mark: "last" as const })); // nothing set: keep all
  for (const o of OPTS) {
    const n = keep[o];
    if (!n) continue;
    const sel = SELECT[o];
    const already = new Set(sorted.filter((b) => b.mark && b.mark !== "remove").map((b) => sel(b.t)));
    const included = new Set<string>();
    for (const b of sorted) {
      if (b.mark) continue;
      const id = sel(b.t);
      if (already.has(id)) continue;
      if (!included.has(id)) {
        if (included.size >= n) break;
        included.add(id);
        b.mark = o;
      } else b.mark = "remove";
    }
  }
  return sorted.map((b) => ({ ...b, mark: b.mark ?? ("remove" as const) }));
}

const PRESETS: { label: string; keep: Record<Opt, number> }[] = [
  { label: "GFS", keep: { last: 3, daily: 7, weekly: 4, monthly: 6, yearly: 1 } },
  { label: "keep-last=7", keep: { last: 7, daily: 0, weekly: 0, monthly: 0, yearly: 0 } },
  { label: "daily 14 · monthly 12", keep: { last: 0, daily: 14, weekly: 0, monthly: 12, yearly: 0 } },
];

export function PruneSim() {
  const [keep, setKeep] = useState<Record<Opt, number>>(PRESETS[0].keep);
  const [twice, setTwice] = useState(false);
  const [gaps, setGaps] = useState(true);

  const backups = useMemo(() => {
    const out: Backup[] = [];
    for (let i = 0; i < DAYS; i++) {
      const day = TODAY - i * DAY;
      if (gaps && (i % 11 === 5 || i % 29 === 13)) continue; // failed/skipped runs
      out.push({ t: day + 21 * 3600000 });
      if (twice) out.push({ t: day + 9 * 3600000 });
    }
    return out.filter((b) => b.t <= TODAY + 21 * 3600000);
  }, [twice, gaps]);

  const marked = useMemo(() => prune(backups, keep), [backups, keep]);
  const byDay = useMemo(() => {
    const m = new Map<string, Backup[]>();
    for (const b of marked) {
      const k = new Date(b.t).toISOString().slice(0, 10);
      m.set(k, [...(m.get(k) ?? []), b]);
    }
    return m;
  }, [marked]);
  const kept = marked.filter((b) => b.mark !== "remove");
  const counts = Object.fromEntries(OPTS.map((o) => [o, kept.filter((b) => b.mark === o).length])) as Record<Opt, number>;

  // calendar: columns = ISO weeks (Mon..Sun), last column contains TODAY
  const todayDow = (new Date(TODAY).getUTCDay() + 6) % 7;
  const lastMonday = TODAY - todayDow * DAY;
  const weeks = 53;
  const spec = OPTS.filter((o) => keep[o]).map((o) => `keep-${o}=${keep[o]}`).join(",") || "(keep all)";

  return (
    <Panel
      title="Prune simulator"
      right={
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Button key={p.label} variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setKeep(p.keep)}>
              {p.label}
            </Button>
          ))}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {OPTS.map((o) => (
          <label key={o} className="flex flex-col gap-1 text-[11px]">
            <span className="font-mono" style={{ color: COLOR[o] }}>keep-{o}</span>
            <input
              type="number"
              min={0}
              max={99}
              value={keep[o]}
              onChange={(e) => setKeep((k) => ({ ...k, [o]: Math.max(0, Math.min(99, Number(e.target.value) || 0)) }))}
              className="w-16 rounded-md border border-line bg-bg px-2 py-1 font-mono text-sm text-ink outline-none focus:border-faint"
            />
          </label>
        ))}
        <div className="flex flex-col gap-1.5">
          <Toggle checked={twice} onChange={setTwice} label="two backups per day" />
          <Toggle checked={gaps} onChange={setGaps} label="some nights failed" />
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `24px repeat(${weeks}, 12px)`, gridTemplateRows: "14px repeat(7, 12px)" }}>
          <div />
          {Array.from({ length: weeks }, (_, w) => {
            const mon = lastMonday - (weeks - 1 - w) * DAY * 7;
            const d = new Date(mon);
            const showMonth = d.getUTCDate() <= 7;
            return (
              <div key={w} className="font-mono text-[9px] whitespace-nowrap text-faint">
                {showMonth ? d.toLocaleString("en", { month: "short", timeZone: "UTC" }) : ""}
              </div>
            );
          })}
          {Array.from({ length: 7 }, (_, dow) => (
            <Row key={dow} dow={dow} weeks={weeks} lastMonday={lastMonday} byDay={byDay} />
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        {OPTS.map((o) => (
          <span key={o} className="flex items-center gap-1.5">
            <i className="size-2.5 rounded-sm" style={{ background: COLOR[o] }} /> kept by {o} ({counts[o]})
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <i className="size-2.5 rounded-sm border border-line bg-panel-2" /> pruned
        </span>
        <span className="flex items-center gap-1.5">
          <i className="size-2.5 rounded-sm border border-dashed border-line" /> no backup
        </span>
      </div>
      <div className="mt-3 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs text-muted">
        prune-backups: <span className="text-ink">{spec}</span>
        <span className="text-faint"> → keeps {kept.length} of {marked.length}</span>
      </div>
    </Panel>
  );
}

function Row({ dow, weeks, lastMonday, byDay }: { dow: number; weeks: number; lastMonday: number; byDay: Map<string, Backup[]> }) {
  return (
    <>
      <div className="font-mono text-[9px] leading-3 text-faint">{["Mon", "", "Wed", "", "Fri", "", "Sun"][dow]}</div>
      {Array.from({ length: weeks }, (_, w) => {
        const t = lastMonday - (weeks - 1 - w) * DAY * 7 + dow * DAY;
        if (t > TODAY) return <div key={w} />;
        const key = new Date(t).toISOString().slice(0, 10);
        const bs = byDay.get(key);
        const k = bs?.find((b) => b.mark !== "remove");
        const title = bs ? `${key}: ${bs.map((b) => `${new Date(b.t).toISOString().slice(11, 16)} ${b.mark === "remove" ? "pruned" : "kept by keep-" + b.mark}`).join(", ")}` : `${key}: no backup`;
        return (
          <div
            key={w}
            title={title}
            className={clsx("size-3 rounded-[2px] transition-colors duration-300", !bs && "border border-dashed border-line", bs && !k && "border border-line bg-panel-2")}
            style={k ? { background: COLOR[k.mark as Opt] } : undefined}
          />
        );
      })}
    </>
  );
}
