/** Tiny deterministic stand-ins for Ceph's rjenkins hash and CRUSH straw2 selection. */

export function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

export type Osd = { id: number; host: number; up: boolean; in: boolean; downAt: number | null };

/**
 * straw2-like choice: every bucket draws a pseudo-random "straw" for this PG and the longest wins.
 * Because each draw depends only on (pg, item), removing an item only moves the PGs that had chosen it.
 * Failure domain = host: pick `size` distinct hosts, then one OSD inside each.
 * Only `in` OSDs are candidates; a down-but-in OSD stays in the mapping (it is just not up).
 */
export function crush(pg: number, osds: Osd[], size: number): number[] {
  const hosts = new Map<number, Osd[]>();
  for (const o of osds) {
    if (!o.in) continue;
    const list = hosts.get(o.host) ?? [];
    list.push(o);
    hosts.set(o.host, list);
  }
  const rankedHosts = [...hosts.keys()].sort((a, b) => hash("h", pg, b) - hash("h", pg, a));
  return rankedHosts.slice(0, size).map((h) => {
    const cands = hosts.get(h)!;
    return cands.reduce((best, o) => (hash("o", pg, o.id) > hash("o", pg, best.id) ? o : best)).id;
  });
}
