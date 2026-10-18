"use client";

/**
 * The four interface sounds, and the rules they play by.
 *
 * Deliberately a module, not a React context: the events that matter here happen
 * inside hooks and dialogs that already sit under every provider in the app, and
 * a context would only add a way for a subtree to end up outside it. The players
 * are created lazily and cached, so a sound that never fires costs nothing.
 *
 * Three rules, each of them a consequence of how browsers and people behave:
 *
 *  - **Nothing plays before a gesture.** Autoplay policy blocks it, and the
 *    refusal arrives as a rejected promise, not an exception. Every call site
 *    here runs after a click, so the promise resolves; if it ever does not, the
 *    sound is silently absent rather than an error on screen.
 *  - **Muting is remembered.** `localStorage`, because a preference that resets
 *    on navigation is not a preference. Storage can throw (private mode, blocked
 *    cookies), and the fallback is sound on rather than off: failing to read a
 *    preference must not look like the user chose silence.
 *  - **A flow with problems warns, it does not celebrate.** Seven sends out of
 *    eight is neither success nor failure, and the tone says so before the copy
 *    does.
 */
export type SoundName = "success" | "error" | "warning" | "popup";

/**
 * Where each sound lives.
 *
 * `public/`, because that is the only directory Next serves at the site root. A
 * `sounds/` folder at the project root is compiled into nothing and 404s at
 * runtime — silently, since a missing `<audio>` source is not an error anyone
 * sees. `lib/ui/sound.test.ts` checks that every file named here exists.
 */
export const SOUND_FILES: Record<SoundName, string> = {
  success: "/sounds/success.mp3",
  error: "/sounds/error.mp3",
  warning: "/sounds/warning.mp3",
  popup: "/sounds/pop-up.mp3",
};

/**
 * Each at its own level, because the files are not recorded at the same one.
 *
 * Measured peaks: success 0.84, warning 0.97, error 0.17, popup 0.17 — the last
 * two are roughly 14 dB quieter than the first two straight out of the encoder.
 * Matching the multipliers would have kept that gap, so `error` and `popup` are
 * pushed up to close it. `popup` still ends up the quietest on purpose: it fires
 * far more often than a transaction lands, and a pop on every menu is the first
 * thing anyone turns off.
 */
const SOUND_VOLUMES: Record<SoundName, number> = {
  success: 0.55,
  error: 0.9,
  warning: 0.45,
  popup: 0.6,
};

const MUTE_KEY = "spacedust:sound-muted";

/** Null until read, so the common path touches storage once per page. */
let muted: boolean | null = null;
let players: Map<SoundName, HTMLAudioElement> | null = null;

export function soundUrl(name: SoundName): string {
  return SOUND_FILES[name];
}

export function isSoundMuted(): boolean {
  if (muted !== null) return muted;
  muted = readMuted();
  return muted;
}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Applies for this page; it just will not survive a reload.
  }
}

function audio(name: SoundName): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof window.Audio !== "function") {
    return null;
  }
  players ??= new Map();
  const existing = players.get(name);
  if (existing) return existing;
  try {
    const player = new window.Audio(SOUND_FILES[name]);
    player.preload = "auto";
    player.volume = SOUND_VOLUMES[name];
    players.set(name, player);
    return player;
  } catch {
    return null;
  }
}

/** Sounds refused by the browser, with when they were refused. */
const blocked = new Map<SoundName, number>();

/**
 * How long a refused sound stays worth retrying.
 *
 * Short on purpose: a confirmation heard twenty seconds later is noise, not
 * feedback. Long enough to cover the case that matters — a tab that was hidden
 * while the transaction landed, and is clicked again when the user comes back.
 */
const RETRY_WINDOW_MS = 20_000;

let retryBound = false;

function retryBlocked(): void {
  const now = Date.now();
  for (const [name, refusedAt] of blocked) {
    blocked.delete(name);
    if (now - refusedAt <= RETRY_WINDOW_MS) playSound(name);
  }
}

/**
 * Play the refused sounds on the next interaction.
 *
 * A browser refuses audio in a hidden tab or without a gesture, and the refusal
 * is a rejected promise — so a confirmation that lands while the user is in the
 * wallet app would otherwise be lost with no trace. The next click is the first
 * moment it is allowed, and usually the click on "Done".
 */
function bindRetry(): void {
  if (retryBound || typeof window === "undefined") return;
  retryBound = true;
  window.addEventListener("pointerdown", retryBlocked, { passive: true });
  window.addEventListener("keydown", retryBlocked);
}

/**
 * Play one sound, restarting it if it is already going.
 *
 * Restarting rather than layering: a second success a moment after the first is
 * a second event, and two overlapping copies of the same mp3 sound like a
 * stutter.
 */
export function playSound(name: SoundName): void {
  if (typeof window === "undefined" || isSoundMuted()) return;
  const player = audio(name);
  if (!player) return;

  try {
    // Rewind only what has metadata. Assigning `currentTime` before the first
    // `loadedmetadata` throws `InvalidStateError` in some browsers — and because
    // the assignment came first, the throw skipped `play()` entirely and the
    // sound was lost with no error anywhere.
    if (player.readyState > 0) player.currentTime = 0;

    const started = player.play();
    if (started && typeof started.catch === "function") {
      started.catch(() => {
        blocked.set(name, Date.now());
        bindRetry();
        console.debug(
          `[spacedust] ${name} sound was blocked; it will play on the next input`,
        );
      });
    }
  } catch (error) {
    // Some embedded browsers throw synchronously instead of rejecting.
    blocked.set(name, Date.now());
    bindRetry();
    console.debug("[spacedust] sound failed:", error);
  }
}

/**
 * Fetch and decode the files before they are needed.
 *
 * Called on the first pointerdown — inside a gesture — so the browser permits
 * both the decode and the playback that follows. Without it the first success
 * arrives late, because the mp3 is still downloading at the moment it should
 * already be playing.
 */
export function primeSounds(): void {
  if (typeof window === "undefined") return;
  for (const name of Object.keys(SOUND_FILES) as SoundName[]) {
    try {
      audio(name)?.load();
    } catch {
      // The first play will try again.
    }
  }
}

/**
 * Play the sound a flow has earned, at the moment it has earned it.
 *
 * Called from the hook that owns the flow, immediately before the state that
 * ends it, not from an effect watching for that state. The difference is not
 * style: an effect can be skipped when the final render is coalesced with a
 * reset, or when the component that owns it unmounts on the same tick — and the
 * one moment the user has been waiting for is the one that goes silent. The
 * patch is the event; the sound belongs beside it.
 *
 * `problems` is the number of items that did not come through. Seven sends out
 * of eight gets the warning tone, which is the same distinction the result
 * screens draw in words.
 */
export function playFlowSound(phase: "success" | "error", problems = 0): void {
  if (phase === "error") {
    playSound("error");
    return;
  }
  playSound(problems > 0 ? "warning" : "success");
}
