# pastly

A fast, clean pastebin. Paste text, get a link, decide when it disappears.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fxditya%2Fpaster&env=UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN&envDescription=Create%20a%20free%20Redis%20database%20at%20console.upstash.com%20and%20paste%20its%20REST%20URL%20and%20token.&envLink=https%3A%2F%2Fconsole.upstash.com&project-name=pastly&repository-name=pastly)

- **Syntax highlighting** for 70 languages (server-rendered, light and dark), with linkable line ranges, wrap toggle and rendered Markdown.
- **Expiry you control**: 10 minutes to never, enforced by the database rather than a cleanup job. **Burn-after-read** destroys a paste the moment it is opened.
- **End-to-end encryption** in the browser (AES-256-GCM). The key lives in the link after `#`, or is derived from a password. The server only ever stores ciphertext.
- **No accounts, no ads, no tracking.** Your pastes and their edit tokens are remembered in *your* browser so you can edit or delete them later.
- **Terminal-first API and CLI**: `curl --data-binary @file host/api/v1/pastes` prints a link; `pastly` (npm) or the curl-installable shell script paste from stdin, files or the clipboard. hastebin clients keep working.
- **Warns before you leak**: the editor flags text that looks like an API key, private key, JWT or password before you save.
- **Operator tools**: a recent/most-reported listing behind `ADMIN_TOKEN`, abuse reports with a webhook, an expiry cap (`MAX_EXPIRY`), and SDK telemetry switched off.
- **Serverless**: Next.js on Vercel with Upstash Redis. Nothing to run.

Built as a successor to [pasty](https://github.com/xditya/pasty). The name is pastly (the repository keeps its codename, `paster`); the visual language borrows the tokens of [engram](https://engram.xditya.me): three greys, one accent, hairlines instead of shadows, Geist and Geist Mono. The feature set comes from [docs/RESEARCH.md](docs/RESEARCH.md), a sourced sweep of what people complain about in pastebins.

## How it flows

**Creating a paste**

1. You type or drop a file on `/`. The language is auto-detected (or picked), and you choose expiry, burn-after-read and encryption.
2. If encryption is on, the browser encrypts `{title, lang, content}` before anything leaves the page. In link mode a random 256-bit key becomes the URL fragment; in password mode PBKDF2 derives it.
3. `POST /api/v1/pastes` validates, allocates an 8-character id, hashes a fresh edit token, and writes the record to Redis with a TTL matching the expiry.
4. The response contains the edit token once. The browser stores it (and the link key) in `localStorage` under "Your pastes", then navigates to `/{id}.{lang}#key`.

**Reading a paste**

1. `GET /{id}` is a server component. It peeks the record, then (unless burn-after-read) runs one atomic Redis script that reads the paste and increments its view counter.
2. Plain pastes are highlighted on the server with shiki and streamed as HTML; the page works without JavaScript.
3. Encrypted pastes arrive as ciphertext; the browser decrypts with the fragment key or asks for the password, then highlights locally.
4. Burn-after-read pastes show a gate. Only clicking "Reveal and destroy" calls the API, which atomically reads and deletes. Link-preview bots therefore never burn a paste.

**Editing and deleting** need `Authorization: Bearer <editToken>`. Only the SHA-256 of the token is stored, and expiry is preserved on edit.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript | Server components for fast, JS-optional reads; route handlers for the API |
| Storage | [Upstash Redis](https://upstash.com) via REST (`@upstash/redis`) | Connectionless, free tier, native TTL = exact expiry with no cron |
| Rate limiting | `@upstash/ratelimit` sliding window | Works across serverless instances |
| Highlighting | shiki 4 (`shiki/core`, JS regex engine, lazy grammars) | Accurate TextMate grammars, dual light/dark output, no WASM |
| Styling | Tailwind CSS 4 with a small token set | Light and dark themes, no component library |
| Crypto | Web Crypto AES-GCM + PBKDF2 | Authenticated encryption, standard in every browser |

### Redis layout

| Key | Type | Notes |
| --- | --- | --- |
| `p:{id}` | JSON string | The paste record; TTL = expiry |
| `v:{id}` | integer | View counter, TTL copied from the paste |
| `r:{id}` | list | Abuse reports, 30-day TTL |
| `s:created`, `s:views` | integer | Global counters for `/api/v1/info` |
| `rl:*` | — | Rate-limit buckets |

A page view is two REST round trips (a peek pipeline, then one Lua script that reads, counts the view, copies the TTL onto the counter and burns if needed); an API read is one. A create is a rate-limit check plus one write. Upstash's free tier (500k commands/month) comfortably covers a personal instance.

## Deploy on Vercel

1. Create a Redis database at [console.upstash.com](https://console.upstash.com) (or add **Upstash for Redis** from the Vercel Marketplace, which sets the env vars for you).
2. Import this repository in Vercel. Framework preset: Next.js. No build settings to change.
3. Set environment variables: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or the Marketplace's `KV_REST_API_URL` / `KV_REST_API_TOKEN`). Optionally `NEXT_PUBLIC_SITE_URL`, `REPORT_WEBHOOK_URL`, `ADMIN_TOKEN`, `MAX_PASTE_BYTES`. See [`.env.example`](.env.example).
4. Deploy. No cron jobs are needed: expiry is Redis TTL. Optional policy: `MAX_EXPIRY=30d` to disable "never".

Any other host that runs Next.js works the same way (Docker, Node, Netlify).

## Develop

```sh
pnpm install
pnpm dev          # http://localhost:3000 — uses an in-memory store when no Upstash credentials are set
pnpm check        # lint + typecheck + unit tests + build
```

End-to-end checks against a running server:

```sh
ALLOW_MEMORY_STORE=1 DISABLE_RATE_LIMIT=1 PORT=3111 pnpm start &
BASE=http://localhost:3111 bash scripts/smoke.sh                 # API contract (curl)
CHROMIUM_PATH=/path/to/chromium BASE=http://localhost:3111 node e2e/ui.mjs   # browser flows + screenshots
```

Add a language: append to `src/lib/langs.ts`, then run `pnpm gen:grammars`.

## CLI

Paste without opening the site. Lives in [`cli/`](cli/) and is published as `pastly`; every instance also serves a shell version.

```sh
npm install -g pastly && pastly config host https://your-host     # Node 20+, supports -E encryption
curl -fsSL https://your-host/install.sh | sh                          # POSIX sh + curl, host preconfigured

ls -la | pastly                 # stdin
pastly main.go -e 1d            # files
pastly clip -E -c               # clipboard → encrypted, link copied back
pastly text "hello" -b          # burn after read
pastly get URL#key              # print/decrypt
pastly ls / pastly rm ID        # history and delete (edit tokens stay on your machine)
```

## API

Everything the site does is available over HTTP; see [`/docs`](src/app/docs/page.tsx) on a running instance.

```sh
# create (terminal clients get the URL as text; JSON clients get JSON)
cat main.go | curl --data-binary @- 'https://your-host/api/v1/pastes?name=main.go&expires=1d'

# read / raw / download
curl https://your-host/api/v1/pastes/ID
curl https://your-host/ID/raw
curl -O https://your-host/ID/raw?dl=1

# edit / delete
curl -X PATCH -H 'Authorization: Bearer TOKEN' -H 'Content-Type: application/json' -d '{"content":"new"}' https://your-host/api/v1/pastes/ID
curl -X DELETE -H 'Authorization: Bearer TOKEN' https://your-host/api/v1/pastes/ID

# hastebin-compatible
curl --data-binary @file https://your-host/documents
```

## Security model

- Edit tokens are 256-bit random values; only their SHA-256 is stored and comparison is constant-time.
- Encrypted pastes hide title and language too. `/raw` returns ciphertext and an `X-Encrypted: 1` header.
- `Referrer-Policy: no-referrer` so URL fragments (keys) never leak through links; a nonce-based CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`); `X-Robots-Tag: noindex` on every paste; framing only allowed for `?embed=1` paste pages.
- Per-IP sliding-window rate limits on create, read (API, pages and OG images), mutate and report; request bodies are capped while streaming, not just by `Content-Length`; 1 MiB content cap; titles capped at 120 characters.
- Self-hosting must sit behind a reverse proxy that appends `X-Forwarded-For` (nginx `$proxy_add_x_forwarded_for`, Caddy's default); set `TRUSTED_PROXY_HOPS` to the number of proxies (default 1; Vercel needs nothing). A directly exposed Node process cannot tell a spoofed header from a real one, so rate limits would be bypassable.
- Encrypted pastes can only be updated with fresh encryption metadata; reusing an IV is rejected.
- Burn-after-read uses an atomic Lua script so two readers can never both see the content.
- Reports store a salted hash of the reporter's IP (never the IP itself; salted with `REPORT_SALT`, else the admin token or the Redis token) for 30 days and are optionally forwarded to a webhook with mentions disabled; `ADMIN_TOKEN` lets an operator delete anything.
- `HEAD` requests never count views or burn pastes, so link checkers and previewers are safe. Every `GET` that returns content does consume a burn-after-read paste.

## Compared with pasty

| | pasty | pastly |
| --- | --- | --- |
| Expiry | one global lifetime, cron cleanup | per paste, exact TTL, plus burn-after-read |
| Encryption | AES-CBC, key in fragment | AES-GCM (authenticated), key in fragment or password |
| Highlighting | highlight.js auto-detect (often wrong) | shiki with a language picker and filename detection |
| Line links, wrap, markdown, OG previews | no | yes |
| Edit/delete | paste token into `prompt()` | remembered per browser; token dialog as fallback |
| Titles, downloads, forking, share/QR | no | yes |
| Hosting | Go binary + Postgres/Mongo/S3 | Vercel + Upstash, zero servers |

## License

MIT
