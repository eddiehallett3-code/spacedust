"use client";

import { useEffect, useRef } from "react";

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
 * Each at its own level, because they are not equally welcome.
 *
 * A failure should be audible. A dialog opening should be felt more than heard —
 * it happens far more often than a transaction lands, and a pop on every menu
 * would be the first thing anyone turns off.
 */
const SOUND_VOLUMES: Record<SoundName, number> = {
  success: 0.5,
  error: 0.45,
  warning: 0.45,
  popup: 0.28,
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
    player.currentTime = 0;
    // A blocked play rejects. That is not an error worth surfacing: silence is
    // already what "no sound" looks like.
    void player.play().catch(() => {});
  } catch {
    // Some embedded browsers throw synchronously instead.
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
 * Play the sound a flow has earned when its phase comes to rest.
 *
 * `problems` is the number of items that did not come through. A flow that sent
 * seven of eight gets the warning tone, which is the same distinction the result
 * screens draw in words.
 */
export function useFlowSound(phase: string, problems = 0): void {
  const previous = useRef(phase);

  useEffect(() => {
    const from = previous.current;
    previous.current = phase;
    if (from === phase) return;

    if (phase === "error") {
      playSound("error");
    } else if (phase === "success") {
      playSound(problems > 0 ? "warning" : "success");
    }
  }, [phase, problems]);
}
