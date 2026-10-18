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
  muted: boolean;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
}

function fakeWindow(play?: () => Promise<void>) {
  const created: FakePlayer[] = [];
  const store = new Map<string, string>();
  const listeners: Record<string, () => void> = {};
  const timers: Array<() => void> = [];

  class FakeAudio {
    src: string;
    volume = 1;
    currentTime = 0;
    readyState = 0;
    preload = "";
    muted = false;
    play = vi.fn(play ?? (() => Promise.resolve()));
    pause = vi.fn();
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
    timers,
    window: {
      Audio: FakeAudio,
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
      setTimeout: (handler: () => void) => {
        timers.push(handler);
        return timers.length;
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

  it("retries a refused sound when the tab becomes visible", async () => {
    // The wallet app took the user away; the confirmation landed while the
    // page was hidden. Returning to the tab should be enough, without a click.
    let refuse = true;
    const { created, window: fake } = fakeWindow(() =>
      refuse ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve(),
    );
    const docListeners: Record<string, () => void> = {};
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener: (type: string, handler: () => void) => {
        docListeners[type] = handler;
      },
    });
    vi.stubGlobal("window", fake);
    const { playSound } = await load();

    playSound("success");
    await Promise.resolve();
    await Promise.resolve();
    expect(created[0]?.play).toHaveBeenCalledTimes(1);

    refuse = false;
    docListeners["visibilitychange"]?.();
    expect(created[0]?.play).toHaveBeenCalledTimes(2);
  });

  it("attempts playback at confirmation even when the tab reports hidden", async () => {
    const { created, window: fake } = fakeWindow();
    const doc = { hidden: true, addEventListener: () => {} };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", fake);
    const { playSound } = await load();

    playSound("success");

    // The old code queued this and waited for visibility; some in-app browsers
    // never fire it, so the cue only played on the Done click.
    expect(created).toHaveLength(1);
    expect(created[0]?.play).toHaveBeenCalledTimes(1);
  });

  it("retries a refused sound on a gesture when the tab still reports hidden", async () => {
    let refuse = true;
    const { created, listeners, window: fake } = fakeWindow(() =>
      refuse ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve(),
    );
    const doc = { hidden: true, addEventListener: () => {} };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", fake);
    const { playSound } = await load();

    playSound("success");
    await Promise.resolve();
    await Promise.resolve();
    expect(created[0]?.play).toHaveBeenCalledTimes(1);

    refuse = false;
    listeners["pointerdown"]?.();
    expect(created[0]?.play).toHaveBeenCalledTimes(2);
  });

  it("retries from the poll when the page has focus but hidden is stale", async () => {
    let refuse = true;
    const { created, timers, window: fake } = fakeWindow(() =>
      refuse ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve(),
    );
    const doc = {
      hidden: true,
      hasFocus: () => true,
      addEventListener: () => {},
    };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", fake);
    const { playSound } = await load();

    playSound("success");
    await Promise.resolve();
    await Promise.resolve();
    expect(created[0]?.play).toHaveBeenCalledTimes(1);
    expect(timers.length).toBeGreaterThan(0);

    // The wallet sheet closes, but no visibility/focus event arrives. The poll
    // sees that the document itself has focus and tries again.
    refuse = false;
    timers[0]?.();
    expect(created[0]?.play).toHaveBeenCalledTimes(2);
  });
});

describe("preload and unlock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preloads a cue once, without playing it", async () => {
    const { created, window: fake } = fakeWindow();
    vi.stubGlobal("window", fake);
    const { preloadSounds } = await load();

    preloadSounds(["success"]);
    expect(created).toHaveLength(1);
    expect(created[0]?.load).toHaveBeenCalledTimes(1);
    expect(created[0]?.play).not.toHaveBeenCalled();

    // A second call must not reload — and therefore must not rewind — a player
    // that is already loaded or playing.
    preloadSounds(["success"]);
    expect(created[0]?.load).toHaveBeenCalledTimes(1);
  });

  it("unlocks every player with a muted play on the first gesture", async () => {
    const { created, window: fake } = fakeWindow();
    vi.stubGlobal("window", fake);
    const { primeSounds } = await load();

    primeSounds();
    expect(created).toHaveLength(4);
    for (const player of created) {
      expect(player.play).toHaveBeenCalledTimes(1);
    }

    // The unlock play resolves, pauses, rewinds and unmutes.
    await Promise.resolve();
    await Promise.resolve();
    for (const player of created) {
      expect(player.pause).toHaveBeenCalled();
      expect(player.muted).toBe(false);
    }

    // A second gesture must not replay the muted unlock.
    primeSounds();
    for (const player of created) {
      expect(player.play).toHaveBeenCalledTimes(1);
    }
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
