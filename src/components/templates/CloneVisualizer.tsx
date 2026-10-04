"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Callout, Panel, Segmented, Stat } from "../ui";

const N = 32; // blocks in the disk, 1 block = 1 GiB of a 32 GiB disk
const BASE_USED = new Set([0, 1, 2, 3, 4, 5, 8, 9, 10, 16, 17, 24]); // where the OS image lives

type Kind = "full" | "linked";
type Storage = "lvmthin" | "zfs" | "rbd" | "qcow2";

// per block: "empty" | "ref" (reads go to base) | "own" (allocated in the clone) | "dirty" (own, just written)
type Cell = "empty" | "ref" | "own" | "new";
type Clone = { id: number; kind: Kind; cells: Cell[]; copying: number | null };

const COLORS = ["#38bdf8", "#34d399", "#a78bfa"];

const STORAGE: Record<Storage, { label: string; base: string; clone: (id: number) => string; how: string }> = {
  lvmthin: {
    label: "LVM-thin",
    base: "pve/base-9000-disk-0  (read-only thin LV)",
    clone: (id) => `pve/vm-${id}-disk-0  = thin snapshot of base-9000-disk-0`,
    how: "lvcreate -s of the read-only base LV; both share the thin pool's chunks until one side writes.",
  },
  zfs: {
    label: "ZFS",
    base: "rpool/data/base-9000-disk-0@__base__",
    clone: (id) => `rpool/data/vm-${id}-disk-0  (zfs clone of @__base__)`,
    how: "zfs snapshot …@__base__ then zfs clone. The snapshot can't be destroyed while clones depend on it.",
  },
  rbd: {
    label: "Ceph RBD",
    base: "rbd/base-9000-disk-0@__base__ (protected)",
    clone: (id) => `rbd/vm-${id}-disk-0  (rbd clone, parent = base@__base__)`,
    how: "The base snapshot is protected and clones are layered RBD images; reads of unwritten objects go to the parent.",
  },
  qcow2: {
    label: "qcow2 (dir/NFS)",
    base: "images/9000/base-9000-disk-0.qcow2",
    clone: (id) => `images/${id}/vm-${id}-disk-0.qcow2  backing_file=../9000/base-9000-disk-0.qcow2`,
    how: "A new qcow2 file whose backing file is the base image. Unallocated clusters are read from the backing file.",
  },
};

function Grid({ cells, color, hot, onHover, label }: { cells: Cell[]; color: string; hot: number | null; onHover?: (i: number | null) => void; label: string }) {
  return (
    <div className="grid grid-cols-8 gap-1" role="img" aria-label={label}>
      {cells.map((c, i) => (
        <div
          key={i}
          onMouseEnter={() => onHover?.(i)}
          onMouseLeave={() => onHover?.(null)}
          className={clsx("aspect-square rounded-[4px] border transition-all duration-300", c === "new" && "animate-flash", hot === i && "scale-110")}
          style={{
            background: c === "own" || c === "new" ? color : c === "ref" ? `${color}14` : "#0a0c11",
            borderColor: c === "ref" ? `${color}88` : c === "empty" ? "#242a38" : color,
            borderStyle: c === "ref" ? "dashed" : "solid",
          }}
        />
      ))}
    </div>
  );
}

export function CloneVisualizer() {
  const [kind, setKind] = useState<Kind>("linked");
  const [storage, setStorage] = useState<Storage>("lvmthin");
  const [clones, setClones] = useState<Clone[]>([]);
  const [hot, setHot] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const base: Cell[] = Array.from({ length: N }, (_, i) => (BASE_USED.has(i) ? "own" : "empty"));

  // drive full-clone copy animation
  const copying = clones.some((c) => c.copying !== null);
  useEffect(() => {
    if (!copying) return;
    const t = setInterval(() => {
      setClones((cs) =>
        cs.map((c) => {
          if (c.copying === null) return c;
          const cells = [...c.cells];
          let k = c.copying;
          while (k < N && !BASE_USED.has(k)) k++;
          if (k >= N) return { ...c, copying: null };
          cells[k] = "own";
          return { ...c, cells, copying: k + 1 };
        }),
      );
    }, 70);
    return () => clearInterval(t);
  }, [copying]);

  // fade "new" to "own"
  useEffect(() => {
    if (!clones.some((c) => c.cells.includes("new"))) return;
    const t = setTimeout(() => setClones((cs) => cs.map((c) => ({ ...c, cells: c.cells.map((x) => (x === "new" ? "own" : x)) }))), 900);
    return () => clearTimeout(t);
  }, [clones]);

  const addClone = () => {
    if (clones.length >= 3) return;
    const id = 101 + clones.length;
    const cells: Cell[] = Array.from({ length: N }, (_, i) => (kind === "linked" && BASE_USED.has(i) ? "ref" : "empty"));
    setClones([...clones, { id, kind, cells, copying: kind === "full" ? 0 : null }]);
    setMsg(null);
  };

  const write = (id: number) => {
    setClones((cs) =>
      cs.map((c) => {
        if (c.id !== id || c.copying !== null) return c;
        const cells = [...c.cells];
        // a guest write: overwrite 2 OS blocks (apt upgrade) and append 1-2 new data blocks
        const used = cells.map((x, i) => (x !== "empty" ? i : -1)).filter((i) => i >= 0);
        const free = cells.map((x, i) => (x === "empty" ? i : -1)).filter((i) => i >= 0);
        const pick = (arr: number[]) => arr.splice(Math.floor(Math.random() * arr.length), 1)[0];
        for (let k = 0; k < 2 && used.length; k++) cells[pick(used)] = "new";
        for (let k = 0; k < 2 && free.length; k++) cells[pick(free)] = "new";
        return { ...c, cells };
      }),
    );
  };

  const delTemplate = () => {
    const linked = clones.filter((c) => c.kind === "linked");
    setMsg(
      linked.length
        ? `✗ qm destroy 9000: refused. Linked clone${linked.length > 1 ? "s" : ""} ${linked.map((c) => c.id).join(", ")} still read their unchanged blocks from the base disk.`
        : "✓ No linked clones depend on it: the template could be destroyed (full clones are independent copies).",
    );
  };

  const baseGiB = BASE_USED.size;
  const ownGiB = clones.reduce((a, c) => a + c.cells.filter((x) => x === "own" || x === "new").length, 0);
  const asFull = baseGiB + clones.reduce((a, c) => a + Math.max(baseGiB, c.cells.filter((x) => x !== "empty").length), 0);
  const st = STORAGE[storage];

  return (
    <Panel
      title="Full clone vs linked clone, block by block"
      right={
        <div className="flex flex-wrap gap-2">
          <Segmented value={storage} onChange={setStorage} options={(Object.keys(STORAGE) as Storage[]).map((k) => ({ value: k, label: STORAGE[k].label }))} />
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "linked", label: "linked clone" },
            { value: "full", label: "full clone" },
          ]}
        />
        <Button variant="primary" onClick={addClone} disabled={clones.length >= 3}>
          qm clone 9000 {101 + clones.length}
          {kind === "full" ? " --full" : ""}
        </Button>
        <Button variant="danger" onClick={delTemplate}>
          qm destroy 9000
        </Button>
        <Button variant="ghost" onClick={() => { setClones([]); setMsg(null); }}>
          reset
        </Button>
      </div>

      <div className="grid gap-5 md:grid-cols-[200px_minmax(0,1fr)]">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-xs text-accent">template 9000</span>
            <span className="text-[10px] text-faint">read-only</span>
          </div>
          <Grid cells={base} color="#e57000" hot={hot} label="Template base disk blocks" />
          <div className="mt-1.5 font-mono text-[10px] leading-snug break-all text-faint">{st.base}</div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {clones.length === 0 && (
            <div className="col-span-full flex min-h-[160px] items-center justify-center rounded-xl border border-dashed border-line p-6 text-center text-sm text-faint">
              Clone the template. A linked clone appears instantly with dashed blocks: they hold no data of their own and
              read through to the base.
            </div>
          )}
          {clones.map((c, k) => {
            const own = c.cells.filter((x) => x === "own" || x === "new").length;
            const refs = c.cells.filter((x) => x === "ref").length;
            return (
              <div key={c.id} className="min-w-0 animate-rise">
                <div className="mb-1 flex items-center justify-between gap-1">
                  <span className="font-mono text-xs" style={{ color: COLORS[k] }}>
                    VM {c.id} · {c.kind}
                  </span>
                  <button
                    type="button"
                    onClick={() => write(c.id)}
                    disabled={c.copying !== null}
                    className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-ink disabled:opacity-40"
                  >
                    guest writes
                  </button>
                </div>
                <Grid cells={c.cells} color={COLORS[k]} hot={hot} onHover={setHot} label={`VM ${c.id} disk blocks`} />
                <div className="mt-1.5 font-mono text-[10.5px] text-muted">
                  {c.copying !== null ? (
                    <span className="animate-pulse-soft text-warn">copying… {own}/{baseGiB} GiB</span>
                  ) : (
                    <>
                      {own} GiB own{c.kind === "linked" && <span className="text-faint"> · {refs} GiB shared</span>}
                    </>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-[9.5px] leading-snug break-all text-faint">
                  {c.kind === "linked" ? st.clone(c.id) : `vm-${c.id}-disk-0 (independent copy)`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="space used" value={`${baseGiB + ownGiB} GiB`} tone="good" />
          <Stat label="if all full" value={`${asFull} GiB`} />
          <Stat label="clones" value={clones.length} />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] border border-dashed border-info bg-info/10" /> shared with base (no space used)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] bg-info" /> allocated in the clone
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] border border-line bg-bg" /> never written (thin)
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted">
        <span className="text-ink">{st.label}:</span> {st.how} Overwriting a shared block is <span className="text-ink">copy-on-write</span>: the
        clone gets its own copy and the base stays untouched, which is exactly why the base must be a read-only template.
      </p>
      {msg && (
        <div className="mt-3">
          <Callout tone={msg.startsWith("✗") ? "bad" : "ok"}>{msg}</Callout>
        </div>
      )}
    </Panel>
  );
}
