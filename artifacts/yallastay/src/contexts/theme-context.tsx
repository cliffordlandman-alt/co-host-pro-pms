import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type ColorScheme = "light" | "dark" | "system";
type AccentColor = "teal" | "gold" | "blue" | "green" | "purple";
type Density = "comfortable" | "compact";

interface ThemeSettings {
  colorScheme: ColorScheme;
  accent: AccentColor;
  density: Density;
}

interface ThemeContextType {
  theme: ThemeSettings;
  setColorScheme: (scheme: ColorScheme) => void;
  setAccent: (accent: AccentColor) => void;
  setDensity: (density: Density) => void;
}

const ACCENT_VARS: Record<AccentColor, { primary: string; ring: string; label: string; swatch: string }> = {
  teal:   { primary: "174 72% 36%",  ring: "174 72% 36%",  label: "YallaStay Teal",  swatch: "#1a9e8f" },
  gold:   { primary: "43 96% 44%",   ring: "43 96% 44%",   label: "Black & Gold",    swatch: "#d4a017" },
  blue:   { primary: "221 83% 53%",  ring: "221 83% 53%",  label: "Ocean Blue",      swatch: "#3b82f6" },
  green:  { primary: "142 71% 45%",  ring: "142 71% 45%",  label: "Emerald",         swatch: "#22c55e" },
  purple: { primary: "262 83% 58%",  ring: "262 83% 58%",  label: "Purple",          swatch: "#8b5cf6" },
};

const DEFAULT_THEME: ThemeSettings = { colorScheme: "light", accent: "teal", density: "comfortable" };

function applyTheme(theme: ThemeSettings) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme.colorScheme === "dark" || (theme.colorScheme === "system" && prefersDark);
  root.classList.toggle("dark", isDark);
  const av = ACCENT_VARS[theme.accent];
  root.style.setProperty("--primary", av.primary);
  root.style.setProperty("--ring", av.ring);
  root.style.setProperty("--sidebar-primary", av.primary);
  root.dataset.density = theme.density;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeSettings>(() => {
    try {
      return JSON.parse(localStorage.getItem("ys_theme") ?? "null") ?? DEFAULT_THEME;
    } catch { return DEFAULT_THEME; }
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("ys_theme", JSON.stringify(theme));
  }, [theme]);

  function setColorScheme(colorScheme: ColorScheme) { setTheme(t => ({ ...t, colorScheme })); }
  function setAccent(accent: AccentColor) { setTheme(t => ({ ...t, accent })); }
  function setDensity(density: Density) { setTheme(t => ({ ...t, density })); }

  return <ThemeContext.Provider value={{ theme, setColorScheme, setAccent, setDensity }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

export { ACCENT_VARS };
export type { ThemeSettings, ColorScheme, AccentColor, Density };
