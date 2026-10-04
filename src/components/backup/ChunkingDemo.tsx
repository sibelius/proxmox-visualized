"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Button, Panel } from "@/components/ui";

const BASE = "#!/bin/sh\nexport PATH=/usr/bin\nlog() { echo \"$1\" >> /var/log/app.log; }\nlog starting\nexec /usr/bin/app --config /etc/app.conf";
const FIXED = 12;

function fixedChunks(s: string) {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += FIXED) out.push(s.slice(i, i + FIXED));
  return out;
}

/** Content-defined chunking: cut where a rolling hash over the last 4 bytes hits a pattern (like PBS's buzhash, tiny scale). */
function dynamicChunks(s: string) {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const len = i - start + 1;
    if (i >= 3) {
      let h = 0;
      for (let k = i - 3; k <= i; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0;
      if ((len >= 4 && h % 9 === 0) || len >= 24) {
        out.push(s.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

export function ChunkingDemo() {
  const [text, setText] = useState(BASE);
  const baseFixed = useMemo(() => new Set(fixedChunks(BASE)), []);
  const baseDyn = useMemo(() => new Set(dynamicChunks(BASE)), []);
  const f = fixedChunks(text);
  const d = dynamicChunks(text);
  const reusedF = f.filter((c) => baseFixed.has(c)).length;
  const reusedD = d.filter((c) => baseDyn.has(c)).length;

  return (
    <Panel
      title="Why file archives use dynamic chunks"
      right={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setText("# v2\n" + text)}>insert a line at the top</Button>
          <Button variant="ghost" onClick={() => setText(BASE)}>↺</Button>
        </div>
      }
    >
      <label className="mb-1 block text-[11px] text-faint" htmlFor="chunk-src">
        a file inside the container&apos;s .pxar stream · edit it
      </label>
      <textarea
        id="chunk-src"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        spellCheck={false}
        className="w-full resize-y rounded-lg border border-line bg-bg p-2 font-mono text-[12px] text-ink outline-none focus:border-faint"
      />
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Chunks title={`fixed ${FIXED}-byte chunks (like VM images)`} chunks={f} known={baseFixed} reused={reusedF} />
        <Chunks title="content-defined chunks (like .pxar)" chunks={d} known={baseDyn} reused={reusedD} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Insert one line at the top. Fixed boundaries all shift, so every later chunk looks new and gets uploaded again. With
        content-defined boundaries, cut points depend on the bytes around them, not on their offset, so after the edit the
        boundaries fall back into the same places and the rest of the stream deduplicates. A block device doesn&apos;t shift its
        data around, so VM images use fixed 4&nbsp;MiB chunks; a file archive does, so .pxar uses dynamic ones.
      </p>
    </Panel>
  );
}

function Chunks({ title, chunks, known, reused }: { title: string; chunks: string[]; known: Set<string>; reused: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-[11px]">
        <span className="text-faint">{title}</span>
        <span className="font-mono">
          <span className="text-ok">{reused} reused</span> · <span className="text-accent">{chunks.length - reused} new</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-bg p-2">
        {chunks.map((c, i) => {
          const old = known.has(c);
          return (
            <span
              key={i + c}
              className={clsx("rounded px-1 py-0.5 font-mono text-[10px] whitespace-pre", old ? "bg-ok/15 text-ok" : "bg-accent/20 text-accent")}
            >
              {c.replace(/\n/g, "⏎")}
            </span>
          );
        })}
      </div>
    </div>
  );
}
