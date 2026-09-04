import type { PasteRecord } from "../paste";

export type ReadResult = { record: PasteRecord; views: number } | null;

export interface PasteStore {
  /** Create a paste. `ttlSeconds` null = never expires. Fails if id already exists. */
  create(record: PasteRecord, ttlSeconds: number | null): Promise<boolean>;
  /** Read and count a view. For burn-after-read pastes this atomically deletes the paste. */
  read(id: string): Promise<ReadResult>;
  /** Read without counting a view or burning. Used for metadata/auth checks. */
  peek(id: string): Promise<ReadResult>;
  /**
   * Read and count a view for a paste already known NOT to be burn-after-read
   * (one round trip; callers peek first). Burn pastes must go through read().
   */
  readNonBurn(id: string): Promise<ReadResult>;
  /** Replace the record, preserving the remaining TTL. */
  update(record: PasteRecord): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  /** Append a report; returns the number of reports for that paste. */
  report(id: string, reason: string, ip: string): Promise<number>;
  /** Global counters for the footer/stats. */
  incrStat(name: "created" | "views"): Promise<void>;
  stats(): Promise<{ created: number; views: number }>;
  /** Cheap liveness check. */
  ping(): Promise<boolean>;
  readonly kind: "redis" | "memory";
}

export const KEY = {
  paste: (id: string) => `p:${id}`,
  views: (id: string) => `v:${id}`,
  reports: (id: string) => `r:${id}`,
  stat: (name: string) => `s:${name}`,
};
