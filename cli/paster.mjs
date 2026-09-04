#!/usr/bin/env node
/**
 * paster — paste from the terminal.
 *
 * Zero dependencies (Node ≥ 20). Talks to any paster instance over its HTTP API and
 * implements the same AES-256-GCM envelope as the website, so `paster -E` pastes are
 * end-to-end encrypted without ever opening a browser.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";

export const VERSION = "0.1.0";
const NAME = "paster";

// ---------------------------------------------------------------------------
// Config & history
// ---------------------------------------------------------------------------

export function configDir() {
  if (process.env.PASTER_CONFIG_DIR) return process.env.PASTER_CONFIG_DIR;
  if (platform() === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), NAME);
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), NAME);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

export function getConfig() {
  return readJson(join(configDir(), "config.json"), {});
}

export function setConfig(patch) {
  writeJson(join(configDir(), "config.json"), { ...getConfig(), ...patch });
}

export function getHistory() {
  const now = Date.now();
  return readJson(join(configDir(), "history.json"), []).filter((p) => p.expires === null || p.expires === undefined || p.expires > now);
}

function remember(entry) {
  const list = getHistory().filter((p) => p.id !== entry.id);
  list.unshift(entry);
  writeJson(join(configDir(), "history.json"), list.slice(0, 500));
}

function forget(id) {
  writeJson(
    join(configDir(), "history.json"),
    getHistory().filter((p) => p.id !== id),
  );
}

export function resolveHost(flag) {
  const host = flag || process.env.PASTER_HOST || getConfig().host;
  if (!host) {
    throw new UsageError(`no host configured. Run \`${NAME} config host https://your-paster.example\` or set PASTER_HOST.`);
  }
  return host.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Crypto — identical envelope to the website (src/lib/crypto.ts)
// ---------------------------------------------------------------------------

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
export const PBKDF2_ITERATIONS = 600_000;

export const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
export const unb64u = (s) => new Uint8Array(Buffer.from(s, "base64url"));

async function deriveKey(password, salt, iterations = PBKDF2_ITERATIONS) {
  const material = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptEnvelope(envelope, opts) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = enc.encode(JSON.stringify(envelope));
  if (opts.password === undefined) {
    const key = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const raw = await subtle.exportKey("raw", key);
    return { ciphertext: b64u(ct), meta: { alg: "AES-GCM", kdf: "fragment", iv: b64u(iv) }, fragment: b64u(raw) };
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(opts.password, salt);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { ciphertext: b64u(ct), meta: { alg: "AES-GCM", kdf: "password", iv: b64u(iv), salt: b64u(salt), iterations: PBKDF2_ITERATIONS } };
}

export async function decryptEnvelope(ciphertext, meta, secret) {
  const key =
    secret.fragment !== undefined
      ? await subtle.importKey("raw", unb64u(secret.fragment), { name: "AES-GCM" }, false, ["decrypt"])
      : await deriveKey(secret.password, unb64u(meta.salt), meta.iterations ?? PBKDF2_ITERATIONS);
  let pt;
  try {
    pt = await subtle.decrypt({ name: "AES-GCM", iv: unb64u(meta.iv) }, key, unb64u(ciphertext));
  } catch {
    throw new CliError("wrong key or corrupted data");
  }
  return JSON.parse(dec.decode(pt));
}

// ---------------------------------------------------------------------------
// Platform helpers: clipboard, browser, prompts
// ---------------------------------------------------------------------------

const isWsl = () => platform() === "linux" && /microsoft/i.test(safeRead("/proc/version"));
function safeRead(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function tryExec(cmds) {
  for (const [cmd, args] of cmds) {
    try {
      return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    } catch {
      /* try the next one */
    }
  }
  return null;
}

export function readClipboard() {
  const os = platform();
  const cmds =
    os === "darwin"
      ? [["pbpaste", []]]
      : os === "win32"
        ? [["powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"]]]
        : [
            ...(process.env.WAYLAND_DISPLAY ? [["wl-paste", ["--no-newline"]]] : []),
            ["xclip", ["-selection", "clipboard", "-o"]],
            ["xsel", ["--clipboard", "--output"]],
            ...(isWsl() ? [["powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"]]] : []),
          ];
  const out = tryExec(cmds);
  if (out === null) throw new CliError("could not read the clipboard (install wl-clipboard, xclip or xsel on Linux)");
  return out;
}

export function writeClipboard(text) {
  const os = platform();
  const cmds =
    os === "darwin"
      ? [["pbcopy", []]]
      : os === "win32"
        ? [["clip", []]]
        : [
            ...(process.env.WAYLAND_DISPLAY ? [["wl-copy", []]] : []),
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--input"]],
            ...(isWsl() ? [["clip.exe", []]] : []),
          ];
  for (const [cmd, args] of cmds) {
    const r = spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
    if (r.status === 0) return true;
  }
  return false;
}

function openInBrowser(url) {
  const os = platform();
  const [cmd, args] = os === "darwin" ? ["open", [url]] : os === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  const r = spawnSync(cmd, args, { stdio: "ignore" });
  return r.status === 0;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const write = rl._writeToOutput;
    rl._writeToOutput = function (s) {
      if (s.includes(question)) write.call(rl, s);
      else write.call(rl, "");
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolve(answer);
    });
  });
}

async function readStdin() {
  if (process.stdin.isTTY) process.stderr.write("Type or paste, then press Ctrl-D:\n");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// ---------------------------------------------------------------------------
// Language from file name (mirrors the server's registry for the common cases)
// ---------------------------------------------------------------------------

const EXT = {
  txt: "text", md: "markdown", markdown: "markdown", js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", mts: "typescript",
  jsx: "jsx", tsx: "tsx", json: "json", jsonc: "jsonc", yml: "yaml", yaml: "yaml", toml: "toml", html: "html", htm: "html", css: "css", scss: "scss",
  vue: "vue", svelte: "svelte", py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift", c: "c", h: "c", cpp: "cpp", cc: "cpp",
  hpp: "cpp", cs: "csharp", php: "php", rb: "ruby", dart: "dart", scala: "scala", hs: "haskell", ex: "elixir", exs: "elixir", erl: "erlang",
  clj: "clojure", lua: "lua", pl: "perl", r: "r", jl: "julia", zig: "zig", nim: "nim", ml: "ocaml", sh: "shellscript", bash: "shellscript",
  zsh: "shellscript", ps1: "powershell", bat: "bat", fish: "fish", nix: "nix", sql: "sql", graphql: "graphql", gql: "graphql", prisma: "prisma",
  proto: "proto", xml: "xml", svg: "xml", diff: "diff", patch: "diff", log: "log", csv: "csv", tex: "latex", tf: "terraform", hcl: "terraform",
  ini: "ini", conf: "ini", cfg: "ini", env: "dotenv", mmd: "mermaid", sol: "solidity", http: "http",
};

export function langFromFilename(name) {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "dockerfile";
  if (lower === "makefile") return "makefile";
  if (lower === ".env" || lower.startsWith(".env.")) return "dotenv";
  const i = lower.lastIndexOf(".");
  return i === -1 ? undefined : EXT[lower.slice(i + 1)];
}

export function parsePasteRef(ref) {
  // Accepts an id, or a URL like https://host/AbCd1234.go#key or https://host/AbCd1234/raw
  let id = ref;
  let key;
  let host;
  try {
    const u = new URL(ref);
    host = u.origin;
    const seg = u.pathname.split("/").filter(Boolean)[0] ?? "";
    id = seg.split(".")[0];
    if (u.hash && !/^#L\d/.test(u.hash)) key = u.hash.slice(1);
  } catch {
    /* plain id */
  }
  if (!/^[A-Za-z0-9]{4,32}$/.test(id)) throw new UsageError(`"${ref}" doesn't look like a paste id or URL`);
  return { id, key, host };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

class UsageError extends Error {}
class CliError extends Error {}

async function api(host, path, init = {}) {
  let res;
  try {
    res = await fetch(host + path, {
      ...init,
      headers: { Accept: "application/json", "User-Agent": `${NAME}-cli/${VERSION}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
  } catch (e) {
    throw new CliError(`could not reach ${host} (${e.cause?.code ?? e.message})`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const msg = data?.error?.message ?? text.trim() ?? res.statusText;
    throw new CliError(`${res.status} ${msg}`);
  }
  return data;
}

async function createPaste(host, { content, title, lang, expires, burn, encrypt, password }) {
  let body;
  let fragment;
  if (encrypt || password !== undefined) {
    const r = await encryptEnvelope({ title, lang: lang ?? "text", content }, { password });
    fragment = r.fragment;
    body = { content: r.ciphertext, enc: r.meta, expires, burn };
  } else {
    body = { content, title, lang, expires, burn };
  }
  const p = await api(host, "/api/v1/pastes", { method: "POST", body: JSON.stringify(body) });
  const url = fragment ? `${p.url}#${fragment}` : p.url;
  remember({ id: p.id, url, editToken: p.editToken, key: fragment, title, lang: p.lang, created: p.created, expires: p.expires, burn: p.burn, encrypted: !!p.enc });
  return { ...p, url };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `${NAME} ${VERSION} — paste from the terminal

Usage
  ${NAME} [options] [file ...]        paste files, or stdin when no file is given
  ${NAME} clip [options]              paste the clipboard
  ${NAME} text [options] <words ...>  paste literal text
  ${NAME} get <id|url> [--json]       print a paste (decrypts when the URL carries a #key)
  ${NAME} ls                          pastes created from this machine
  ${NAME} rm <id|url>                 delete a paste created from this machine
  ${NAME} config [host <url>]         show or set the default host

Options
  -t, --title <text>      title (defaults to the file name)
  -l, --lang <id>         language id or alias (default: from the file name, else auto)
  -e, --expires <when>    10m | 1h | 1d | 7d | 30d | never  (default: 7d)
  -b, --burn              destroy after the first read
  -E, --encrypt           encrypt here; the key goes in the URL after #
  -p, --password <pw>     encrypt with a password instead ("-P" prompts for it)
  -P, --ask-password      prompt for a password
  -c, --copy              copy the URL to the clipboard
  -o, --open              open the URL in a browser
  -r, --raw               print the raw URL (plain text) instead of the page URL
  -j, --json              print the full API response
  -H, --host <url>        server to use (env PASTER_HOST, or \`${NAME} config host …\`)
  -h, --help              show this help
  -v, --version           show the version

Examples
  ls -la | ${NAME}
  ${NAME} main.go --expires 1d
  ${NAME} clip -E -c                  # encrypted clipboard paste, URL copied back
  ${NAME} text "hello there" -b       # burn after read
  ${NAME} get https://host/AbCd1234#key > file.txt
`;

function fmtRel(ms) {
  const d = ms - Date.now();
  const abs = Math.abs(d);
  const u = abs < 60e3 ? [1e3, "s"] : abs < 3600e3 ? [60e3, "m"] : abs < 86400e3 ? [3600e3, "h"] : [86400e3, "d"];
  const n = Math.round(abs / u[0]);
  return d >= 0 ? `in ${n}${u[1]}` : `${n}${u[1]} ago`;
}

export async function main(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      title: { type: "string", short: "t" },
      lang: { type: "string", short: "l" },
      expires: { type: "string", short: "e" },
      burn: { type: "boolean", short: "b", default: false },
      encrypt: { type: "boolean", short: "E", default: false },
      password: { type: "string", short: "p" },
      "ask-password": { type: "boolean", short: "P", default: false },
      copy: { type: "boolean", short: "c", default: false },
      open: { type: "boolean", short: "o", default: false },
      raw: { type: "boolean", short: "r", default: false },
      json: { type: "boolean", short: "j", default: false },
      host: { type: "string", short: "H" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (o.help) return out(HELP);
  if (o.version) return out(`${NAME} ${VERSION}\n`);

  const [cmd, ...rest] = positionals;

  if (cmd === "config") {
    if (rest[0] === "host" && rest[1]) {
      setConfig({ host: rest[1].replace(/\/+$/, "") });
      return out(`host set to ${rest[1]}\n`);
    }
    const cfg = getConfig();
    return out(`host: ${process.env.PASTER_HOST || cfg.host || "(not set)"}\nconfig: ${configDir()}\n`);
  }

  if (cmd === "ls") {
    const list = getHistory();
    if (!list.length) return out("no pastes yet\n");
    for (const p of list) {
      const flags = [p.encrypted && "enc", p.burn && "burn"].filter(Boolean).join(",");
      out(`${p.id}  ${(p.title || p.lang || "").padEnd(24).slice(0, 24)}  ${fmtRel(p.created).padEnd(9)}  ${p.expires ? "expires " + fmtRel(p.expires) : "never expires"}${flags ? "  [" + flags + "]" : ""}\n  ${p.url}\n`);
    }
    return;
  }

  if (cmd === "get") {
    if (!rest[0]) throw new UsageError("usage: get <id|url>");
    const ref = parsePasteRef(rest[0]);
    const host = ref.host ?? resolveHost(o.host);
    const p = await api(host, `/api/v1/pastes/${ref.id}`);
    if (o.json) return out(JSON.stringify(p, null, 2) + "\n");
    if (!p.enc) return out(p.content);
    let secret;
    if (p.enc.kdf === "fragment") {
      const key = ref.key ?? getHistory().find((h) => h.id === ref.id)?.key;
      if (!key) throw new CliError("this paste is encrypted; pass the full URL including the #key");
      secret = { fragment: key };
    } else {
      secret = { password: o.password ?? (await promptHidden("Password: ")) };
    }
    const env = await decryptEnvelope(p.content, p.enc, secret);
    return out(env.content);
  }

  if (cmd === "rm") {
    if (!rest[0]) throw new UsageError("usage: rm <id|url>");
    const ref = parsePasteRef(rest[0]);
    const host = ref.host ?? resolveHost(o.host);
    const entry = getHistory().find((h) => h.id === ref.id);
    const token = entry?.editToken ?? process.env.PASTER_EDIT_TOKEN;
    if (!token) throw new CliError(`no edit token for ${ref.id} on this machine (set PASTER_EDIT_TOKEN to use one)`);
    await api(host, `/api/v1/pastes/${ref.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    forget(ref.id);
    return out(`deleted ${ref.id}\n`);
  }

  // ---- create ----
  const host = resolveHost(o.host);
  const password = o["ask-password"] ? await promptHidden("Password: ") : o.password;
  const items = [];
  if (cmd === "clip") {
    items.push({ content: readClipboard(), title: o.title });
  } else if (cmd === "text") {
    if (!rest.length) throw new UsageError("usage: text <words ...>");
    items.push({ content: rest.join(" "), title: o.title });
  } else {
    const files = cmd ? [cmd, ...rest] : [];
    if (!files.length) items.push({ content: await readStdin(), title: o.title });
    for (const f of files) {
      if (!existsSync(f)) throw new UsageError(`no such file: ${f}`);
      const buf = readFileSync(f);
      if (buf.includes(0)) throw new CliError(`${f} looks binary; only text can be pasted`);
      items.push({ content: buf.toString("utf8"), title: o.title ?? basename(f), lang: o.lang ?? langFromFilename(basename(f)) });
    }
  }

  for (const item of items) {
    if (!item.content.trim()) throw new CliError("nothing to paste");
    const p = await createPaste(host, {
      content: item.content,
      title: item.title,
      lang: item.lang ?? o.lang,
      expires: o.expires,
      burn: o.burn,
      encrypt: o.encrypt,
      password,
    });
    const url = o.raw ? p.rawUrl : p.url;
    if (o.json) out(JSON.stringify(p, null, 2) + "\n");
    else out(url + "\n");
    if (o.copy) {
      if (writeClipboard(url)) process.stderr.write("copied to clipboard\n");
      else process.stderr.write("could not copy to clipboard\n");
    }
    if (o.open) openInBrowser(url);
  }
}

function out(s) {
  process.stdout.write(s);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain || (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => {
    const usage = err instanceof UsageError || err?.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" || err?.code?.startsWith?.("ERR_PARSE_ARGS");
    process.stderr.write(`${NAME}: ${err.message}\n${usage ? `Run \`${NAME} --help\` for usage.\n` : ""}`);
    process.exit(usage ? 2 : 1);
  });
}
