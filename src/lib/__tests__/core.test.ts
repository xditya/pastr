import { describe, expect, it } from "vitest";
import { isValidId, newId, ID_ALPHABET } from "../ids";
import { hashToken, newEditToken, safeEqual, verifyToken } from "../tokens";
import { expiresAt, expirySeconds, formatDuration, formatRelative, normalizeExpiry } from "../expiry";
import { getLang, langFromFilename, normalizeLang, splitIdAndLang, extensionFor } from "../langs";
import { detectLang } from "../detect";
import { byteLength, formatBytes } from "../bytes";
import { createPasteSchema, updatePasteSchema } from "../validation";

describe("ids", () => {
  it("generates 8-char ids from the safe alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const id = newId();
      expect(id).toHaveLength(8);
      for (const c of id) expect(ID_ALPHABET).toContain(c);
      expect(isValidId(id)).toBe(true);
    }
  });
  it("rejects garbage ids", () => {
    expect(isValidId("")).toBe(false);
    expect(isValidId("a")).toBe(false);
    expect(isValidId("../etc")).toBe(false);
    expect(isValidId("abc def")).toBe(false);
    expect(isValidId("legacy6")).toBe(true);
  });
});

describe("tokens", () => {
  it("round-trips hash verification", async () => {
    const t = newEditToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    const h = await hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyToken(t, h)).toBe(true);
    expect(await verifyToken(t + "x", h)).toBe(false);
  });
  it("safeEqual compares strictly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});

describe("expiry", () => {
  it("maps presets", () => {
    expect(expirySeconds("10m")).toBe(600);
    expect(expirySeconds("never")).toBeNull();
    expect(expiresAt("1h", 1000)).toBe(1000 + 3_600_000);
    expect(expiresAt("never", 1000)).toBeNull();
    expect(normalizeExpiry("bogus")).toBe("7d");
    expect(normalizeExpiry("1d")).toBe("1d");
  });
  it("formats", () => {
    expect(formatRelative(Date.now() + 3_600_000 * 3)).toBe("in 3 hours");
    expect(formatRelative(Date.now() - 86_400_000 * 2)).toBe("2 days ago");
    expect(formatDuration(3_720_000)).toBe("1h 2m");
    expect(formatDuration(90_000_000)).toBe("1d 1h");
  });
});

describe("langs", () => {
  it("resolves aliases and filenames", () => {
    expect(getLang("py")?.id).toBe("python");
    expect(getLang("TS")?.id).toBe("typescript");
    expect(normalizeLang("nope")).toBe("text");
    expect(langFromFilename("main.rs")?.id).toBe("rust");
    expect(langFromFilename("Dockerfile")?.id).toBe("dockerfile");
    expect(langFromFilename(".env.local")?.id).toBe("dotenv");
    expect(langFromFilename("README")).toBeUndefined();
    expect(splitIdAndLang("abc123.ts")).toEqual({ id: "abc123", lang: "ts" });
    expect(splitIdAndLang("abc123")).toEqual({ id: "abc123" });
    expect(extensionFor("go")).toBe("go");
    expect(extensionFor("text")).toBe("txt");
  });
});

describe("detectLang", () => {
  it("guesses common languages conservatively", () => {
    expect(detectLang('{"a": 1}')).toBe("json");
    expect(detectLang("#!/bin/bash\necho hi")).toBe("shellscript");
    expect(detectLang("package main\n\nfunc main() {}")).toBe("go");
    expect(detectLang("def foo():\n    return 1")).toBe("python");
    expect(detectLang("fn main() {\n let x = 1;\n}")).toBe("rust");
    expect(detectLang("SELECT * FROM users;")).toBe("sql");
    expect(detectLang("# Title\n\nSome *text*")).toBe("markdown");
    expect(detectLang("hello there, just some prose.")).toBe("text");
    expect(detectLang("")).toBe("text");
  });
});

describe("bytes", () => {
  it("counts utf-8 bytes", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("é")).toBe(2);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});

describe("validation", () => {
  it("accepts a minimal paste and normalizes", () => {
    const r = createPasteSchema.parse({ content: "hi", lang: "py", burn: "true" });
    expect(r.lang).toBe("python");
    expect(r.burn).toBe(true);
    expect(r.title).toBeUndefined();
  });
  it("parses loose booleans from forms and query strings", () => {
    expect(createPasteSchema.parse({ content: "x", burn: "false" }).burn).toBe(false);
    expect(createPasteSchema.parse({ content: "x", burn: "0" }).burn).toBe(false);
    expect(createPasteSchema.parse({ content: "x", burn: "" }).burn).toBe(false);
    expect(createPasteSchema.parse({ content: "x", burn: "yes" }).burn).toBe(true);
    expect(createPasteSchema.parse({ content: "x", burn: "1" }).burn).toBe(true);
    expect(createPasteSchema.parse({ content: "x", burn: true }).burn).toBe(true);
    expect(createPasteSchema.parse({ content: "x" }).burn).toBe(false);
    expect(createPasteSchema.safeParse({ content: "x", burn: "maybe" }).success).toBe(false);
  });
  it("update can clear the title", () => {
    expect(updatePasteSchema.parse({ title: "" }).title).toBe("");
    expect(updatePasteSchema.parse({ title: null }).title).toBe("");
    expect(updatePasteSchema.parse({ title: " keep " }).title).toBe("keep");
  });
  it("rejects empty and oversized content", () => {
    expect(createPasteSchema.safeParse({ content: "   " }).success).toBe(false);
    expect(createPasteSchema.safeParse({ content: "x".repeat(1024 * 1024 + 1) }).success).toBe(false);
  });
  it("validates encryption meta", () => {
    const ok = createPasteSchema.safeParse({ content: "abc", enc: { alg: "AES-GCM", kdf: "fragment", iv: "AAAAAAAAAAAAAAAA" } });
    expect(ok.success).toBe(true);
    const bad = createPasteSchema.safeParse({ content: "abc", enc: { alg: "AES-CBC", kdf: "fragment", iv: "AAAAAAAAAAAAAAAA" } });
    expect(bad.success).toBe(false);
  });
  it("update requires a field", () => {
    expect(updatePasteSchema.safeParse({}).success).toBe(false);
    expect(updatePasteSchema.safeParse({ title: "x" }).success).toBe(true);
  });
});
