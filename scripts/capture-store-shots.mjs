/**
 * Capture the store listing screenshots from the live site.
 *
 * Usage: node scripts/capture-store-shots.mjs [baseUrl]
 *
 * Why this is not a `chrome --screenshot` loop:
 *
 *  - `--screenshot` photographs the viewport. On a phone the viewport is exactly
 *    the landing hero, so the wallet scan preview below it can never appear — and
 *    the point of the first shot is showing the product.
 *  - It cannot tell whether a WebGL scene has finished. The saucer's canvas is
 *    appended before the model loads, and the host div only becomes opaque once a
 *    frame has been drawn. This waits on that, not on a stopwatch.
 *  - It cannot crop. `Page.captureScreenshot` takes a clip, so each file comes
 *    out exactly 1080 wide at 2x with no post-processing — which keeps this
 *    script free of dependencies (no sharp, no ws, no puppeteer).
 *
 * Renderer: ANGLE Metal, i.e. the real GPU. Software WebGL draws this model
 * flat: on the saucer's bounding box, the GPU render has 6.2% bright pixels
 * against 0.0%, and 1,611 distinct colours against 198.
 *
 * Requires Node 22+ for the built-in WebSocket, and Chrome at CHROME_PATH.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = (process.argv[2] ?? "https://spacedust.cc").replace(/\/$/, "");
const OUT = path.join(process.cwd(), "public", "press");

/** Portrait 9:16 at 2x, and the taller first shot that reaches the scan card. */
const PHONE = { width: 540, height: 960 };
const TALL = { width: 540, height: 1560 };

const SHOTS = [
  {
    file: "screenshot-1-landing.jpg",
    url: "/",
    clip: TALL,
    why: "hero and the scan entry point in one frame",
  },
  {
    file: "screenshot-1b-landing-9x16.jpg",
    url: "/",
    clip: PHONE,
    why: "the same hero at 9:16, for stores that insist on it",
  },
  { file: "screenshot-2-scan.jpg", url: "/scan", clip: PHONE },
  { file: "screenshot-3-salvage.jpg", url: "/salvage", clip: PHONE },
  { file: "screenshot-4-slingshot.jpg", url: "/slingshot", clip: PHONE },
  { file: "screenshot-5-security.jpg", url: "/security", clip: PHONE },
  { file: "screenshot-6-how-it-works.jpg", url: "/how-it-works", clip: PHONE },
  {
    file: "screenshot-7-payload.jpg",
    url: "/payload",
    clip: PHONE,
    why: "batch send, before anything is chosen",
  },
  {
    file: "screenshot-8-void.jpg",
    url: "/void",
    clip: PHONE,
    why: "the send-or-burn choice, before anything is chosen",
  },
  {
    file: "screenshot-9-approvals.jpg",
    url: "/approvals",
    clip: PHONE,
    why: "every delegation on the wallet, before connecting",
  },
];

/**
 * Capture a subset, for adding a shot without refilming the set.
 *
 * `ONLY=payload,void node scripts/capture-store-shots.mjs` matches on filename,
 * so the images already published keep the exact bytes they had. A full run
 * rewrites all of them, which is right when the design changes and wrong when
 * one tool is simply missing.
 */
const ONLY = (process.env.ONLY ?? "")
  .split(",")
  .map((token) => token.trim().toLowerCase())
  .filter(Boolean);

const selectedShots =
  ONLY.length === 0
    ? SHOTS
    : SHOTS.filter((shot) =>
        ONLY.some((token) => shot.file.toLowerCase().includes(token)),
      );

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getJson(port, requestPath, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port, path: requestPath, method },
      (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`unexpected response from ${requestPath}`));
          }
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}
/**
 * One browser for every shot: launching Chrome per file doubles the run time.
 */
async function withPage(port, run) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await getJson(port, "/json/version");
      break;
    } catch {
      await sleep(250);
    }
  }

  const target = await getJson(port, "/json/new?url=about:blank", "PUT");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const problems = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }

    if (
      message.method === "Log.entryAdded" &&
      message.params.entry.level === "error"
    ) {
      problems.push(`log: ${message.params.entry.text}`.slice(0, 220));
    }
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params.type === "error"
    ) {
      problems.push(
        `console: ${message.params.args
          .map((arg) => arg.value ?? arg.description ?? arg.type)
          .join(" ")}`.slice(0, 220),
      );
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = (nextId += 1);
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  try {
    await send("Page.enable");
    await send("Log.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: PHONE.width,
      height: PHONE.height,
      deviceScaleFactor: 2,
      mobile: true,
    });
    return await run({ send, problems });
  } finally {
    socket.close();
  }
}

/**
 * Wait until the page is worth photographing.
 *
 * The hero reports readiness through its own fade: `ready` sets the host to
 * `opacity-100`, and that only happens after the first frame, so an opaque
 * canvas with a non-zero backing store is proof the model is on screen. Pages
 * without a model need the document loaded, then a settle long enough for the
 * storage notice to dismiss itself (7s) so it is not in a listing image.
 */
async function settle(send, { needsSaucer }) {
  for (let attempt = 0; attempt < 70; attempt += 1) {
    await sleep(400);
    const { result } = await send("Runtime.evaluate", {
      expression: `(() => {
        const canvases = [...document.querySelectorAll('canvas')];
        // The page also paints a decorative starfield on a canvas, so "a canvas
        // exists" means nothing. The model's host is the one carrying the fade
        // classes, and its opacity is the app's own readiness signal.
        const drawn = canvases.filter((c) => {
          const host = c.parentElement;
          if (!host || !String(host.className).includes('transition-opacity')) return false;
          return getComputedStyle(host).opacity === '1' && c.width > 1;
        });
        return { loaded: document.readyState === 'complete', drawn: drawn.length };
      })()`,
      returnByValue: true,
    });

    if (!result.value.loaded) continue;
    if (needsSaucer && result.value.drawn === 0) continue;
    await sleep(needsSaucer ? 2500 : 9000);
    return;
  }
  throw new Error("page never settled");
}

async function main() {
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      // Real GPU. Software WebGL draws this model without its textures.
      "--use-angle=metal",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${path.join("/tmp", `store-shots-${port}`)}`,
      `--window-size=${PHONE.width},${PHONE.height}`,
    ],
    { stdio: "ignore" },
  );

  fs.mkdirSync(OUT, { recursive: true });

  try {
    await withPage(port, async ({ send, problems }) => {
      for (const shot of selectedShots) {
        const started = Date.now();
        await send("Page.navigate", { url: `${BASE}${shot.url}` });
        await settle(send, { needsSaucer: shot.url === "/" });

        const capture = await send("Page.captureScreenshot", {
          format: "jpeg",
          quality: 86,
          // `scale: 1`, deliberately: Emulation's deviceScaleFactor of 2 already
          // renders at 2x, so a clip scale of 2 here would produce 2160-wide
          // files. Caught by measuring the output, not by assuming.
          clip: {
            x: 0,
            y: 0,
            width: shot.clip.width,
            height: shot.clip.height,
            scale: 1,
          },
          captureBeyondViewport: true,
        });

        const target = path.join(OUT, shot.file);
        fs.writeFileSync(target, Buffer.from(capture.data, "base64"));
        const bytes = fs.statSync(target).size;

        console.log(
          `${shot.file.padEnd(34)} ${shot.clip.width * 2}x${shot.clip.height * 2} ` +
            `${String(Math.round(bytes / 1024)).padStart(4)} KB ` +
            `(${Date.now() - started}ms)${shot.why ? ` — ${shot.why}` : ""}`,
        );

        // Anything the page complained about usually means the capture is of a
        // broken state, so it is reported next to the file it belongs to.
        for (const problem of problems.splice(0)) console.log(`  ! ${problem}`);
      }
    });
  } finally {
    chrome.kill("SIGKILL");
  }
}

main().catch((error) => {
  console.error("capture failed:", error.message);
  process.exit(1);
});

