/** Proxmox-ish mark: a host with three guests. Also used by the OG renderer, so plain SVG only. */
export function Logo({ className = "size-8", size }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 32 32" className={size ? undefined : className} width={size} height={size} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#171b24" />
      <rect x="6" y="20" width="20" height="5" rx="1.5" fill="#e57000" />
      <rect x="6" y="8" width="5.5" height="9" rx="1.5" fill="#38bdf8" />
      <rect x="13.25" y="8" width="5.5" height="9" rx="1.5" fill="#34d399" />
      <rect x="20.5" y="8" width="5.5" height="9" rx="1.5" fill="#a78bfa" />
    </svg>
  );
}
