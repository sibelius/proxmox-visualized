"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Pill, Toggle } from "@/components/ui";
import { CONTENT_TYPES, STORAGES, type StorageKind, type Tri } from "./data";

type Need = "vmdisks" | "shared" | "snapshots" | "thin" | "clones" | "block" | "backup";

const NEEDS: { id: Need; label: string; test: (s: StorageKind) => Tri; why: string }[] = [
  { id: "vmdisks", label: "holds VM disks", test: (s) => (s.content.includes("images") ? "yes" : "no"), why: "no images content" },
  { id: "shared", label: "shared across nodes", test: (s) => s.shared, why: "local to one node" },
  { id: "snapshots", label: "VM snapshots", test: (s) => s.snapshots, why: "no snapshots" },
  { id: "thin", label: "thin provisioning", test: (s) => s.thin, why: "fully allocated" },
  { id: "clones", label: "linked clones", test: (s) => s.clones, why: "full clones only" },
  { id: "block", label: "block-level", test: (s) => (s.level === "file" ? "no" : "yes"), why: "file-level" },
  { id: "backup", label: "stores backups", test: (s) => (s.content.includes("backup") ? "yes" : "no"), why: "no backup content" },
];

function Mark({ v, note }: { v: Tri; note?: string }) {
  return (
    <span
      title={note}
      className={clsx(
        "inline-flex size-5 items-center justify-center rounded font-mono text-[11px]",
        v === "yes" && "bg-ok/15 text-ok",
        v === "no" && "bg-bad/10 text-bad/80",
        v === "partial" && "bg-warn/15 text-warn",
      )}
      aria-label={v === "partial" ? `conditional${note ? `: ${note}` : ""}` : v}
    >
      {v === "yes" ? "✓" : v === "no" ? "–" : "~"}
    </span>
  );
}

export function StorageChooser() {
  const [needs, setNeeds] = useState<Set<Need>>(new Set(["vmdisks"]));
  const [strict, setStrict] = useState(false);
  const [open, setOpen] = useState<string>("lvmthin");

  const scored = useMemo(
    () =>
      STORAGES.map((s) => {
        const misses: string[] = [];
        const partials: string[] = [];
        for (const n of NEEDS) {
          if (!needs.has(n.id)) continue;
          const v = n.test(s);
          if (v === "no") misses.push(n.why);
          if (v === "partial") (strict ? misses : partials).push(n.label);
        }
        return { s, misses, partials, fit: misses.length === 0 };
      }),
    [needs, strict],
  );
  const fits = scored.filter((x) => x.fit).length;
  const sel = STORAGES.find((s) => s.id === open)!;

  const toggle = (n: Need) =>
    setNeeds((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-faint">I need:</span>
        {NEEDS.map((n) => (
          <button
            key={n.id}
            type="button"
            aria-pressed={needs.has(n.id)}
            onClick={() => toggle(n.id)}
            className={clsx(
              "rounded-full border px-3 py-1 text-xs transition",
              needs.has(n.id) ? "border-accent bg-accent/15 text-ink" : "border-line bg-panel-2 text-muted hover:text-ink",
            )}
          >
            {n.label}
          </button>
        ))}
        <span className="ml-auto">
          <Toggle checked={strict} onChange={setStrict} label={<span className="text-xs">treat “~ conditional” as no</span>} />
        </span>
      </div>
      <div className="text-xs text-muted">
        <span className="font-mono text-accent">{fits}</span> of {STORAGES.length} storage types fit. Click a row for details.
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-panel-2/60 text-left text-[11px] text-muted uppercase">
              <th className="px-3 py-2 font-semibold">storage</th>
              <th className="px-2 py-2 font-semibold">type</th>
              <th className="px-2 py-2 font-semibold">level</th>
              <th className="px-2 py-2 text-center font-semibold">shared</th>
              <th className="px-2 py-2 text-center font-semibold">snapshots</th>
              <th className="px-2 py-2 text-center font-semibold">thin</th>
              <th className="px-2 py-2 text-center font-semibold">clones</th>
              <th className="px-2 py-2 font-semibold">formats</th>
            </tr>
          </thead>
          <tbody>
            {scored.map(({ s, misses, partials, fit }) => (
              <tr
                key={s.id}
                onClick={() => setOpen(s.id)}
                className={clsx(
                  "cursor-pointer border-t border-line transition",
                  fit ? "opacity-100" : "opacity-35 hover:opacity-70",
                  open === s.id ? "bg-accent/10" : "hover:bg-panel-2/60",
                )}
              >
                <td className="px-3 py-2">
                  <button type="button" className="text-left font-medium text-ink" onClick={() => setOpen(s.id)}>
                    {s.name}
                    {s.preview && <span className="ml-1.5 rounded bg-warn/15 px-1 text-[10px] text-warn">preview</span>}
                  </button>
                  {!fit && <div className="text-[11px] text-bad/80">{misses.join(" · ")}</div>}
                  {fit && partials.length > 0 && <div className="text-[11px] text-warn/80">conditional: {partials.join(", ")}</div>}
                </td>
                <td className="px-2 py-2 font-mono text-xs text-accent">{s.type}</td>
                <td className="px-2 py-2 text-xs text-muted">{s.level}</td>
                <td className="px-2 py-2 text-center">
                  <Mark v={s.shared} note={s.sharedNote} />
                </td>
                <td className="px-2 py-2 text-center">
                  <Mark v={s.snapshots} note={s.snapNote} />
                </td>
                <td className="px-2 py-2 text-center">
                  <Mark v={s.thin} />
                </td>
                <td className="px-2 py-2 text-center">
                  <Mark v={s.clones} note={s.clones === "partial" ? "linked clones need qcow2" : undefined} />
                </td>
                <td className="px-2 py-2 font-mono text-[11px] text-muted">{s.formats.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div key={sel.id} className="grid animate-rise gap-4 rounded-xl border border-line bg-panel-2/40 p-4 md:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{sel.name}</span>
            <Pill color="var(--color-accent)">{sel.type}</Pill>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">{sel.blurb}</p>
          {(sel.sharedNote || sel.snapNote) && (
            <ul className="mt-2 space-y-1 text-xs text-faint">
              {sel.sharedNote && <li>shared: {sel.sharedNote}</li>}
              {sel.snapNote && <li>snapshots: {sel.snapNote}</li>}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-2 text-[11px] tracking-wide text-faint uppercase">content types it accepts</div>
          <div className="flex flex-wrap gap-1.5">
            {CONTENT_TYPES.map((c) => {
              const on = sel.content.includes(c.id);
              return (
                <span
                  key={c.id}
                  title={c.what}
                  className={clsx(
                    "rounded-md border px-2 py-0.5 font-mono text-[11px]",
                    on ? "border-ok/40 bg-ok/10 text-ok" : "border-line text-faint line-through",
                  )}
                >
                  {c.label}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <p className="text-xs text-faint">
        ✓ supported · ~ conditional (hover for the condition) · – not supported. “Shared” means every node sees the same volume, so live migration
        and HA need no disk copy; it does not make a local disk shared.
      </p>
    </div>
  );
}
