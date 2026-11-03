import { useState } from "react";

/**
 * Light / dark mode. Dark is the default; the sun / moon button switches it, and the choice is saved
 * in this browser. index.html applies it before the page draws, so there's no flash of the wrong theme.
 */
export type Theme = "light" | "dark";

const current = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked (private windows); the choice still works for this visit.
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current);

  const toggle = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    save("theme", next);
    setTheme(next);
  };

  return { theme, toggle };
}

/**
 * Color presets, like Discord's theme colors. Pink is the default. The colors here are only for the
 * swatches in the picker; the real colors live in styles.css under [data-accent="…"].
 * index.html applies the saved choice before the page draws. Keep its list in sync with this one.
 */
export const ACCENTS = [
  { id: "pink", label: "Pink", dark: "#ff4fa3", light: "#d92f84" },
  { id: "red", label: "Red", dark: "#ff5c5c", light: "#d63333" },
  { id: "orange", label: "Orange", dark: "#ff8a3d", light: "#c25410" },
  { id: "gold", label: "Gold", dark: "#f5c542", light: "#8f6c00" },
  { id: "green", label: "Green", dark: "#3ddc84", light: "#1c8549" },
  { id: "teal", label: "Teal", dark: "#2fd4c4", light: "#0d7d73" },
  { id: "blue", label: "Blue", dark: "#5b8cff", light: "#2f62d9" },
  { id: "purple", label: "Purple", dark: "#a970ff", light: "#7a3fd6" },
  { id: "mono", label: "Mono", dark: "#e6e6e6", light: "#2b2b2b" },
] as const;

export type Accent = (typeof ACCENTS)[number]["id"];

const currentAccent = (): Accent => {
  const a = document.documentElement.dataset.accent;
  return ACCENTS.some((x) => x.id === a) ? (a as Accent) : "pink";
};

export function useAccent() {
  const [accent, setAccentState] = useState<Accent>(currentAccent);

  const setAccent = (next: Accent) => {
    if (next === "pink") delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = next;
    save("accent", next);
    setAccentState(next);
  };

  return { accent, setAccent };
}
