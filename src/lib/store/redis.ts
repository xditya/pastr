import { Redis } from "@upstash/redis";
import type { PasteRecord } from "../paste";
import { KEY, type PasteStore, type ReadResult } from "./types";

/**
 * One round trip per read:
 *  - increments the per-paste view counter and the global one
 *  - burn-after-read pastes are deleted in the same atomic step, so two readers can
 *    never both see the content
 *  - the first view copies the paste's remaining TTL (ms precision) onto the counter,
 *    so counters never outlive their paste
 * The burn flag is detected on the serialized JSON (`"burn":true`); inside the
 * `content`/`title` strings every quote is escaped, so the pattern cannot occur there.
 */
const READ_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if not v then return nil end
local n = redis.call('INCR', KEYS[2])
redis.call('INCR', KEYS[3])
if string.find(v, '"burn":true', 1, true) then
  redis.call('DEL', KEYS[1], KEYS[2])
elseif n == 1 then
  local t = redis.call('PTTL', KEYS[1])
  if t >= 0 then redis.call('PEXPIRE', KEYS[2], math.max(t, 1000)) end
end
return {v, n}
`;

const REPORTS_TTL = 60 * 60 * 24 * 30;

function parseRecord(raw: unknown): PasteRecord | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as PasteRecord;
    } catch {
      return null;
    }
  }
  return raw as PasteRecord;
}

export class RedisStore implements PasteStore {
  readonly kind = "redis" as const;
  constructor(private redis: Redis) {}

  static fromEnv(url: string, token: string): RedisStore {
    return new RedisStore(new Redis({ url, token }));
  }

  async create(record: PasteRecord, ttlSeconds: number | null): Promise<boolean> {
    const key = KEY.paste(record.id);
    const res =
      ttlSeconds === null
        ? await this.redis.set(key, record, { nx: true })
        : await this.redis.set(key, record, { nx: true, ex: ttlSeconds });
    return res === "OK";
  }

  async read(id: string): Promise<ReadResult> {
    const res = await this.redis.eval<[], [unknown, number] | null>(
      READ_SCRIPT,
      [KEY.paste(id), KEY.views(id), KEY.stat("views")],
      [],
    );
    if (!res) return null;
    const record = parseRecord(res[0]);
    if (!record) return null;
    return { record, views: Number(res[1]) || 0 };
  }

  async peek(id: string): Promise<ReadResult> {
    const p = this.redis.pipeline();
    p.get(KEY.paste(id));
    p.get(KEY.views(id));
    const [raw, views] = await p.exec<[unknown, number | null]>();
    const record = parseRecord(raw);
    if (!record) return null;
    return { record, views: Number(views) || 0 };
  }

  async update(record: PasteRecord): Promise<boolean> {
    const res = await this.redis.set(KEY.paste(record.id), record, { xx: true, keepTtl: true });
    return res === "OK";
  }

  async delete(id: string): Promise<boolean> {
    const p = this.redis.pipeline();
    p.del(KEY.paste(id));
    p.del(KEY.views(id), KEY.reports(id));
    const [deleted] = await p.exec<[number, number]>();
    return Number(deleted) > 0;
  }

  async report(id: string, reason: string, reporter: string): Promise<number> {
    const key = KEY.reports(id);
    const p = this.redis.pipeline();
    p.rpush(key, JSON.stringify({ reason, reporter, at: Date.now() }));
    p.expire(key, REPORTS_TTL);
    const [n] = await p.exec<[number, number]>();
    return Number(n) || 0;
  }

  async incrStat(name: "created" | "views"): Promise<void> {
    await this.redis.incr(KEY.stat(name));
  }

  async stats() {
    const [created, views] = await this.redis.mget<[number | null, number | null]>(KEY.stat("created"), KEY.stat("views"));
    return { created: Number(created) || 0, views: Number(views) || 0 };
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}
