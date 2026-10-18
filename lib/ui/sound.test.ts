import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sounds are the part of the UI nothing type-checks.
 *
 * A missing mp3 is a 404 on a fetched asset, which no test would see and no user
 * would report as a bug — the app simply stays silent. So the first rule here is
 * that every name maps to a file that exists in `public/`. The rest lock the two
 * behaviours that are invisible until they are wrong: mute is remembered, and a
 * blocked autoplay is not an error.
 */

interface FakePlayer {
  src: string;
  volume: number;
  currentTime: number;
  preload: string;
  play: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
}

function fakeWindow(play?: () => Promise<void>) {
  const created: FakePlayer[] = [];
  const store = new Map<string, string>();
  const listeners: Record<string, () => void> = {};

  class FakeAudio {
    src: string;
    volume = 1;
    currentTime = 0;
    readyState = 0;
    preload = "";
    play = vi.fn(play ?? (() => Promise.resolve()));
    load = vi.fn();

    constructor(src: string) {
      this.src = src;
      created.push(this as unknown as FakePlayer);
    }
  }

  return {
    created,
    store,
    listeners,
    window: {
      Audio: FakeAudio,
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
      addEventListener: (type: string, handler: () => void) => {
        listeners[type] = handler;
      },
    },
  };
}

async function load() {
  vi.resetModules();
  return import("@/lib/ui/sound");
}

describe("sound files", () => {
  it("names only files that are actually served", async () => {
    const { SOUND_FILES } = await load();

    for (const [name, url] of Object.entries(SOUND_FILES)) {
      const file = path.join(process.cwd(), "public", url);
      expect(existsSync(file), `${name} → ${url} is missing from public/`).toBe(
        true,
      );
    }
  });

  it("serves them from public, where Next can reach them", async () => {
    const { SOUND_FILES } = await load();

    for (const url of Object.values(SOUND_FILES)) {
      expect(url.startsWith("/sounds/")).toBe(true);
    }
  });
});

describe("playSound", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing on the server", async () => {
    const { playSound } = await load();

    // No window: this is the render path. It must be a no-op, not a crash.
    expect(() => playSound("success")).not.toThrow();
  });

  it("plays the mapped file, once, from the start", async () => {
    const { created, window: fake } = fakeWindow();
    vi.stubGlobal("window", fake);
    const { playSound } = await load();

    playSound("warning");
    playSound("warning");

    // One element per sound, reused: two overlapping copies of the same mp3
    // sound like a stutter.
    expect(created).toHaveLength(1);
    const [player] = created;
    expect(player?.src).toBe("/sounds/warning.mp3");
    expect(player?.play).toHaveBeenCalledTimes(2);
    expect(player?.currentTime).toBe(0);
  });

  it("swallows a refused autoplay instead of surfacing it", async () => {
    const { window: fake } = fakeWindow(() =>
      Promise.reject(new Error("NotAllowedError")),
    );
    vi.stubGlobal("window", fake);
    const { playSound } = await load();

    expect(() => playSound("success")).not.toThrow();
    // Let the rejection settle. If it were unhandled, vitest would fail the run.
    await Promise.resolve();
  });

  it("stays quiet while muted", async () => {
    const { created, window: fake } = fakeWindow();
    vi.stubGlobal("window", fake);
    const { playSound, setSoundMuted } = await load();

    setSoundMuted(true);
    playSound("success");

    expect(created).toHaveLength(0);
  });

  it("retries a refused sound on the next interaction", async () => {
    // What a hidden tab or a missing gesture does: `play()` rejects and the
    // sound is lost. The flow has already finished, so the only way the user
    // hears the confirmation is a second attempt when they touch the page.
    let refuse = true;
    const { created, listeners, window: fake } = fakeWindow(() =>
      refuse ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve(),
    );
    vi.stubGlobal("window", fake);
    const { playSound } = await load();

    playSound("success");
    // Let the rejection settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(created[0]?.play).toHaveBeenCalledTimes(1);

    refuse = false;
    listeners["pointerdown"]?.();
    expect(created[0]?.play).toHaveBeenCalledTimes(2);
  });
});

describe("playFlowSound", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("celebrates a clean run and warns on a partial one", async () => {
    const { created, window: fake } = fakeWindow();
    vi.stubGlobal("window", fake);
    const { playFlowSound } = await load();

    playFlowSound("success", 0);
    expect(created.map((player) => player.src)).toEqual([
      "/sounds/success.mp3",
    ]);

    created.length = 0;
    // One asset failed. That is not a success, whatever the transaction did.
    playFlowSound("success", 1);
    expect(created.map((player) => player.src)).toEqual([
      "/sounds/warning.mp3",
    ]);
  });

  it("plays the error tone for a failure", async () => {
    const { created, window: fake } = fakeWindow();
    vi.stubGlobal("window", fake);
    const { playFlowSound } = await load();

    playFlowSound("error");
    expect(created.map((player) => player.src)).toEqual(["/sounds/error.mp3"]);
  });
});

describe("mute preference", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is remembered in storage", async () => {
    const { store, window: fake } = fakeWindow();
    vi.stubGlobal("window", fake);
    const { isSoundMuted, setSoundMuted } = await load();

    expect(isSoundMuted()).toBe(false);
    setSoundMuted(true);

    // A reload: fresh module, same storage.
    vi.resetModules();
    const reloaded = await import("@/lib/ui/sound");
    expect(reloaded.isSoundMuted()).toBe(true);
    expect(store.get("spacedust:sound-muted")).toBe("1");
  });

  it("defaults to sound on when storage cannot be read", async () => {
    vi.stubGlobal("window", {
      Audio: function Audio() {},
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    const { isSoundMuted, setSoundMuted } = await load();

    expect(isSoundMuted()).toBe(false);
    // Writing throws too; the preference still applies to this page.
    expect(() => setSoundMuted(true)).not.toThrow();
    expect(isSoundMuted()).toBe(true);
  });
});
