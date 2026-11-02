import { useState } from "react";

/**
 * Light / dark mode. Dark is the default; the sun / moon button switches it, and the choice is saved
 * in this browser. index.html applies it before the page draws, so there's no flash of the wrong theme.
 */
export type Theme = "light" | "dark";

const current = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current);

  const toggle = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage can be blocked (private windows); the switch still works for this visit.
    }
    setTheme(next);
  };

  return { theme, toggle };
}
