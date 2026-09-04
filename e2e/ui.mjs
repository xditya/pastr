// Browser smoke test + screenshots. Usage: BASE=http://localhost:3111 node e2e/ui.mjs
// Requires a running server (memory store is fine) and Playwright's Chromium.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3111";
const OUT = process.env.OUT ?? "e2e/screens";
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

async function setSwitch(pg, label, on) {
  const sw = pg.locator(`button[role=switch][aria-label="${label}"]`);
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !/404/.test(m.text()) && errors.push(m.text()));
page.on("response", (r) => r.status() >= 400 && !/\/zzzzzzzz$/.test(r.url()) && errors.push(`${r.status()} ${r.url()}`));

// ---- Home / editor
await page.goto(BASE + "/");
await page.waitForSelector("textarea[name=content]");
await page.screenshot({ path: `${OUT}/01-home-light.png` });
check("home renders editor", await page.locator("textarea[name=content]").isVisible());

// Type, pick language, save with keyboard
const code = 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello")\n}\n';
await page.fill("textarea[name=content]", code);
await page.fill("input[name=title]", "main.go");
await page.selectOption("select[name=lang]", "go");
await page.selectOption("select[name=expires]", "1d");
await page.keyboard.press("Control+s");
await page.waitForURL(/\/[A-Za-z0-9]{8}\.go$/, { timeout: 15000 });
const pasteUrl = page.url();
check("save navigates to paste", /\.go$/.test(pasteUrl), pasteUrl);
await page.waitForSelector("h1");
await page.screenshot({ path: `${OUT}/02-paste-light.png` });
check("title shown", (await page.locator("h1").innerText()).includes("main.go"));
check("highlighting applied", (await page.locator('td span[style*="--shiki-light"]').count()) > 0);
check("gutter has 7+ lines", (await page.locator("tr[id^=L]").count()) >= 7);
check("edit token remembered (Edit enabled)", !(await page.locator('button[title^="Edit"]').isDisabled()));

// line linking
await page.click("#L3 a");
check("line click sets hash", page.url().endsWith("#L3"));
await page.click("#L5 a", { modifiers: ["Shift"] });
check("shift-click extends range", page.url().endsWith("#L3-L5"));
check("range highlighted", (await page.locator("tr.line-hl").count()) === 3);

// dark mode screenshot
await page.emulateMedia({ colorScheme: "dark" });
await page.evaluate(() => { localStorage.setItem("theme", "dark"); document.documentElement.classList.add("dark"); });
await page.screenshot({ path: `${OUT}/03-paste-dark.png` });
check("dark tokens applied", await page.evaluate(() => getComputedStyle(document.body).backgroundColor === "rgb(10, 10, 10)"));
await page.evaluate(() => { localStorage.setItem("theme", "light"); document.documentElement.classList.remove("dark"); });
await page.emulateMedia({ colorScheme: "light" });

// edit flow
await page.click('button[title^="Edit"]');
await page.waitForSelector("textarea[name=content]");
await page.fill("textarea[name=content]", code.replace("hello", "edited"));
await page.click('button[type=submit]');
await page.waitForFunction(() => document.body.innerText.includes("edited"), null, { timeout: 15000 });
check("edit saved and re-rendered", (await page.locator("table").innerText()).includes("edited"));

// your pastes menu
await page.click('button[aria-label="Your pastes"]');
check("local pastes menu lists paste", (await page.locator('#your-pastes').innerText()).includes("main.go"));
await page.keyboard.press("Escape");

// ---- Markdown
await page.goto(BASE + "/");
await page.fill("textarea[name=content]", "# Title\n\nSome **bold** text and `code`.\n\n- a\n- b\n\n```js\nconsole.log(1)\n```\n");
await page.selectOption("select[name=lang]", "markdown");
await page.click('button[type=submit]');
await page.waitForURL(/\.markdown$/, { timeout: 15000 });
await page.waitForSelector("article.prose");
check("markdown preview renders", (await page.locator("article.prose h1").innerText()) === "Title");
await page.screenshot({ path: `${OUT}/04-markdown.png` });
await page.click("text=Source");
check("markdown source toggle", (await page.locator("table tr[id^=L]").count()) > 5);

// ---- Encrypted (fragment key)
await page.goto(BASE + "/");
await page.fill("textarea[name=content]", "SECRET_VALUE_123\nline two");
await page.selectOption("select[name=lang]", "text");
await setSwitch(page, "Encrypt in browser", true);
await setSwitch(page, "Protect with a password instead of a link key", false);
await page.click('button[type=submit]');
await page.waitForURL(/\/[A-Za-z0-9]{8}#[A-Za-z0-9_-]{43}$/, { timeout: 15000 });
const encUrl = page.url();
await page.waitForFunction(() => document.body.innerText.includes("SECRET_VALUE_123"), null, { timeout: 15000 });
check("encrypted paste decrypts with fragment", true, encUrl);
await page.screenshot({ path: `${OUT}/05-encrypted.png` });
const id = encUrl.match(/\/([A-Za-z0-9]{8})#/)[1];
const rawRes = await page.request.get(`${BASE}/${id}/raw`);
check("raw of encrypted paste is ciphertext", !(await rawRes.text()).includes("SECRET_VALUE_123") && rawRes.headers()["x-encrypted"] === "1");
// fresh context without key → asks for key
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
await p2.goto(`${BASE}/${id}`);
await p2.waitForSelector("input[placeholder=Key]");
check("encrypted paste without key asks for it", true);
await p2.screenshot({ path: `${OUT}/06-encrypted-gate.png` });
await p2.fill("input[placeholder=Key]", encUrl.split("#")[1]);
await p2.click("button:has-text('Decrypt')");
await p2.waitForFunction(() => document.body.innerText.includes("SECRET_VALUE_123"), null, { timeout: 15000 });
check("manual key decrypts", true);
await ctx2.close();

// ---- Password encrypted
await page.goto(BASE + "/");
await page.fill("textarea[name=content]", "PW_SECRET");
await setSwitch(page, "Encrypt in browser", true);
await setSwitch(page, "Protect with a password instead of a link key", true);
await page.fill('input[aria-label=Password]', "hunter2");
await page.click('button[type=submit]');
await page.waitForURL(/\/[A-Za-z0-9]{8}$/, { timeout: 15000 });
await page.waitForSelector("input[placeholder=Password]");
await page.fill("input[placeholder=Password]", "wrong");
await page.click("button:has-text('Decrypt')");
await page.waitForFunction(() => document.body.innerText.includes("wrong key"), null, { timeout: 15000 });
check("wrong password rejected", true);
await page.fill("input[placeholder=Password]", "hunter2");
await page.click("button:has-text('Decrypt')");
await page.waitForFunction(() => document.body.innerText.includes("PW_SECRET"), null, { timeout: 20000 });
check("password decrypts", true);

// ---- Burn after read
await page.goto(BASE + "/");
await page.fill("textarea[name=content]", "BURN_ME");
await setSwitch(page, "Encrypt in browser", false);
await setSwitch(page, "Burn after read", true);
await page.click('button[type=submit]');
await page.waitForURL(/\/[A-Za-z0-9]{8}$/, { timeout: 15000 });
const burnUrl = page.url();
await page.waitForSelector("button:has-text('Reveal and destroy')");
await page.screenshot({ path: `${OUT}/07-burn-gate.png` });
check("burn gate shown before reveal", true);
const ctx3 = await browser.newContext();
const p3 = await ctx3.newPage();
await p3.goto(burnUrl);
await p3.waitForSelector("button:has-text('Reveal and destroy')");
check("burn paste survives a page load without reveal", true);
await p3.click("button:has-text('Reveal and destroy')");
await p3.waitForFunction(() => document.body.innerText.includes("BURN_ME"), null, { timeout: 15000 });
check("burn reveal shows content", true);
await p3.reload();
check("burned paste is gone (404)", (await p3.locator("text=Nothing here").count()) > 0);
await ctx3.close();

// ---- Docs + 404 + mobile
await page.goto(BASE + "/docs");
check("docs page", (await page.locator("h1").count()) > 0);
await page.screenshot({ path: `${OUT}/08-docs.png`, fullPage: true });
await page.goto(BASE + "/zzzzzzzz");
check("404 page", (await page.locator("text=Nothing here").count()) > 0);
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const mp = await mobile.newPage();
await mp.goto(BASE + "/");
await mp.screenshot({ path: `${OUT}/09-mobile-home.png` });
await mp.goto(pasteUrl);
await mp.waitForSelector("h1");
await mp.screenshot({ path: `${OUT}/10-mobile-paste.png` });
check("no horizontal overflow on mobile", await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await mobile.close();

check("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
