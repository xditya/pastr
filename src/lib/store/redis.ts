import { Redis } from "@upstash/redis";
import type { PasteRecord } from "../paste";
import { KEY, type PasteStore, type ReadResult } from "./types";

/**
 * Atomic read + view count. Copies the paste TTL onto the view counter the first
 * time it is created so counters never outlive their paste.
 */
const READ_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if not v then return nil end
local n = redis.call('INCR', KEYS[2])
if n == 1 then
  local t = redis.call('TTL', KEYS[1])
  if t > 0 then redis.call('EXPIRE', KEYS[2], t) end
end
return {v, n}
`;

/** Atomic burn-after-read: fetch and delete in one step so two readers can't both see it. */
const BURN_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if not v then return nil end
local n = redis.call('INCR', KEYS[2])
redis.call('DEL', KEYS[1], KEYS[2])
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

  private async runRead(script: string, id: string): Promise<ReadResult> {
    const res = await this.redis.eval<[], [unknown, number] | null>(script, [KEY.paste(id), KEY.views(id)], []);
    if (!res) return null;
    const record = parseRecord(res[0]);
    if (!record) return null;
    return { record, views: Number(res[1]) || 0 };
  }

  async read(id: string): Promise<ReadResult> {
    // We don't know whether it's a burn paste until we read it. Peek first (1 round trip),
    // then do the atomic op that matches. The peek is cheap and keeps the scripts simple.
    const peek = await this.redis.get<PasteRecord | string>(KEY.paste(id));
    const record = parseRecord(peek);
    if (!record) return null;
    return this.runRead(record.burn ? BURN_SCRIPT : READ_SCRIPT, id);
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
    const n = await this.redis.del(KEY.paste(id), KEY.views(id), KEY.reports(id));
    return n > 0;
  }

  async report(id: string, reason: string, ip: string): Promise<number> {
    const key = KEY.reports(id);
    const p = this.redis.pipeline();
    p.rpush(key, JSON.stringify({ reason, ip, at: Date.now() }));
    p.expire(key, REPORTS_TTL);
    const [n] = await p.exec<[number, number]>();
    return Number(n) || 0;
  }

  async incrStat(name: "created" | "views"): Promise<void> {
    await this.redis.incr(KEY.stat(name));
  }

  async stats() {
    const [created, views] = await this.redis.mget<[number | null, number | null]>(
      KEY.stat("created"),
      KEY.stat("views"),
    );
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
