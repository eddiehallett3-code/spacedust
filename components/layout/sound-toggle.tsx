"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { isSoundMuted, playSound, setSoundMuted } from "@/lib/ui/sound";

/**
 * "Sound on / off", in the footer rather than the navbar.
 *
 * Sound is a courtesy, not a feature, so it gets one quiet line where a person
 * looks when something is bothering them — not a control competing with the
 * flows. The preference is remembered in storage (see `lib/ui/sound.ts`), which
 * is also why the label is initially "Sound on": the server cannot read storage,
 * and rendering "off" first would show every visitor a preference they never set
 * until hydration corrected it.
 */
export function SoundToggle() {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setMuted(isSoundMuted());
  }, []);

  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
    // Turning sound *on* should make a sound; otherwise the control gives no
    // evidence that it did anything.
    if (!next) playSound("popup");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={!muted}
      aria-label={
        muted ? "Turn interface sounds on" : "Turn interface sounds off"
      }
      className="mt-3 inline-flex items-center gap-1.5 text-xs text-subtle transition-colors hover:text-foreground"
    >
      {muted ? (
        <VolumeX className="size-3.5" aria-hidden />
      ) : (
        <Volume2 className="size-3.5" aria-hidden />
      )}
      {muted ? "Sound off" : "Sound on"}
    </button>
  );
}
