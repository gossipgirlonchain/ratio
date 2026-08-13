"use client";

/**
 * One sound in the whole product: the bet-placed blip. OFF by default —
 * the toggle lives in the sidebar and the choice is remembered. Generated
 * with WebAudio (no asset, no fetch): two quick rising tones, ~180ms.
 */
const KEY = "ratio-sound";

export const soundEnabled = (): boolean =>
  typeof window !== "undefined" && localStorage.getItem(KEY) === "1";

export const setSoundEnabled = (on: boolean): void => {
  localStorage.setItem(KEY, on ? "1" : "0");
};

export function playPlacedSound(): void {
  if (!soundEnabled()) return;
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(ctx.destination);
    [523.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(1, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
      osc.connect(g);
      g.connect(gain);
      osc.start(t0);
      osc.stop(t0 + 0.15);
    });
    setTimeout(() => void ctx.close(), 500);
  } catch {
    // no audio context (old browser, autoplay policy): silently skip
  }
}
