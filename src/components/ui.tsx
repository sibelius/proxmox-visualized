
import type { ReactNode } from "react";
import clsx from "clsx";

export function PageHeader({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <header className="mb-8 max-w-3xl animate-rise">
      <div className="mb-2 font-mono text-xs text-accent">{n}</div>
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
      <div className="mt-3 text-[15px] leading-relaxed text-muted text-pretty">{children}</div>
    </header>
  );
}

export function Panel({
  title,
  right,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("flex min-w-0 flex-col rounded-xl border border-line bg-panel", className)}>
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>
          {right}
        </div>
      )}
      <div className={clsx("min-w-0 flex-1 p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Section heading inside a page, for long pages with several demos. */
export function Section({ title, kicker, children }: { title: string; kicker?: string; children?: ReactNode }) {
  return (
    <div className="mt-12 mb-4 max-w-3xl">
      {kicker && <div className="mb-1 font-mono text-[11px] tracking-wide text-faint uppercase">{kicker}</div>}
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children && <div className="mt-2 text-sm leading-relaxed text-muted text-pretty">{children}</div>}
    </div>
  );
}

export function Takeaways({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-10 grid gap-3 md:grid-cols-3">
      {items.map((item, i) => (
        <li key={i} className="rounded-xl border border-line bg-panel/60 p-4 text-sm leading-relaxed text-muted">
          <span className="mb-2 block font-mono text-xs text-accent">why it matters</span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "ok"; title?: ReactNode; children: ReactNode }) {
  return (
    <div
      className={clsx(
        "rounded-xl border-l-2 bg-panel/60 px-4 py-3 text-sm leading-relaxed text-muted",
        tone === "info" && "border-info",
        tone === "warn" && "border-warn",
        tone === "bad" && "border-bad",
        tone === "ok" && "border-ok",
      )}
    >
      {title && <div className="mb-1 font-medium text-ink">{title}</div>}
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "good" | "bad" | "warn" | "neutral" }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2/60 px-3 py-2">
      <div className="text-[11px] tracking-wide text-faint uppercase">{label}</div>
      <div
        className={clsx(
          "mt-0.5 font-mono text-lg tabular-nums",
          tone === "good" && "text-ok",
          tone === "bad" && "text-bad",
          tone === "warn" && "text-warn",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function Pill({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={clsx("inline-flex items-center gap-1 rounded-full border border-line bg-panel-2 px-2 py-0.5 font-mono text-[11px] text-muted", className)}
      style={color ? { borderColor: `color-mix(in srgb, ${color} 55%, transparent)`, color } : undefined}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "default",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "ghost" | "danger";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent text-black hover:brightness-110",
        variant === "default" && "border border-line bg-panel-2 text-ink hover:border-faint",
        variant === "ghost" && "text-muted hover:bg-panel-2 hover:text-ink",
        variant === "danger" && "border border-bad/50 bg-bad/10 text-bad hover:bg-bad/20",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Segmented control: pick one of a few options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: readonly (T | { value: T; label: ReactNode })[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx("inline-flex flex-wrap rounded-lg border border-line bg-panel-2 p-0.5", className)}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={clsx(
              "rounded-md px-2.5 py-1 text-xs font-medium transition",
              v === value ? "bg-bg text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted select-none">
      <span
        className={clsx("relative h-5 w-9 rounded-full border border-line transition", checked ? "bg-accent/80" : "bg-panel-2")}
      >
        <span className={clsx("absolute top-0.5 size-3.5 rounded-full bg-ink transition-all", checked ? "left-4.5" : "left-0.5")} />
      </span>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(v),
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => ReactNode;
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-36 accent-[var(--color-accent)]"
      />
      <span className="min-w-12 font-mono text-xs tabular-nums">{format(value)}</span>
    </label>
  );
}

/** Plain monospace block for client components (no highlighting). Use <Code> from server pages for highlighted code. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre className={clsx("overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed text-muted", className)}>
      {children}
    </pre>
  );
}

/** Comparison table: rows × columns with arbitrary cells. */
export function Matrix({ columns, rows }: { columns: ReactNode[]; rows: { label: ReactNode; cells: ReactNode[] }[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="bg-panel-2/60 text-left">
            <th className="border-b border-line px-3 py-2 text-xs font-semibold text-muted" />
            {columns.map((c, i) => (
              <th key={i} className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="odd:bg-panel/40">
              <td className="border-b border-line px-3 py-2 text-xs font-medium whitespace-nowrap text-muted">{r.label}</td>
              {r.cells.map((c, j) => (
                <td key={j} className="border-b border-line px-3 py-2 align-top text-[13px] text-muted">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
