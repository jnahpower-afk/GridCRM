import { createContext, useContext, useState, useEffect } from "react";

// ─── FUSE THEME (current warm/light design) ─────────────────────────────────

const FUSE = {
  name: "fuse",

  // Page backgrounds
  pageBg: "#EEE9DF",
  surfaceBg: "#FAF7F2",
  elevatedBg: "#FFFFFF",
  inputBg: "#FFFFFF",

  // Text
  textPrimary: "#1B2632",
  textSecondary: "#5A6E82",
  textTertiary: "#9AAAB8",
  textMuted: "#C9C1B1",

  // Borders
  border: "#C9C1B1",
  borderSubtle: "#E8E3DA",
  borderHover: "#9AAAB8",

  // Accent (Fuse orange)
  accent: "#FC6A0A",
  accentBg: "#FFF3E8",
  accentHover: "#E55D06",

  // Status
  success: "#4A8C5C",
  successBg: "#E8F5EC",
  warning: "#FFB162",
  warningBg: "#FFF8F0",
  error: "#DC2626",
  errorBg: "#FEF2F2",
  info: "#2563EB",
  infoBg: "#EFF6FF",

  // Components
  headerBg: "#EEE9DF",
  sidebarBg: "#EEE9DF",
  cardBg: "#FAF7F2",
  cardBorder: "#C9C1B1",
  tableLabelBg: "#FAF8F5",
  tableValueBg: "#FFFFFF",

  // Toggle / pill
  pillBg: "#E8E2D6",
  pillBorder: "#C9C1B1",
  pillActiveBg: "#FAF7F2",
  pillActiveText: "#1B2632",
  pillInactiveText: "#9AAAB8",

  // Badges
  badgePurpleBg: "#F3E8FF",
  badgePurpleText: "#7C3AED",

  // Checkbox accent
  checkboxAccent: "#4A8C5C",

  // Shadows
  shadowSm: "0 1px 2px rgba(0,0,0,0.06)",
  shadowMd: "0 2px 8px rgba(0,0,0,0.08)",

  // Progress bar track
  progressTrack: "#E8E3DA",

  // Stepper
  stepperLine: "#E8E3DA",
  stepperLineComplete: "#4A8C5C",

  // Hover
  hoverBg: "#DDD7CB",

  // Link
  link: "#2563EB",

  // Gate
  gateNogo: "#DC2626",
  gateNogoBg: "#FEF2F2",
  gateNogoBorder: "#FECACA",
  gateGo: "#4A8C5C",
  gateGoBg: "#E8F5EC",

  // Scrollbar
  scrollbarThumb: "#C9C1B1",
  scrollbarTrack: "transparent",
};

// ─── LINEAR THEME (dark, minimal, inspired by Linear app) ────────────────────

const LINEAR = {
  name: "linear",

  // Page backgrounds
  pageBg: "#08090A",
  surfaceBg: "#101112",
  elevatedBg: "#161718",
  inputBg: "#161718",

  // Text
  textPrimary: "#F7F8F8",
  textSecondary: "#D0D6E0",
  textTertiary: "#8A8F98",
  textMuted: "#62666D",

  // Borders
  border: "#23252A",
  borderSubtle: "rgba(255,255,255,0.08)",
  borderHover: "rgba(255,255,255,0.15)",

  // Accent (Linear indigo)
  accent: "#5E6AD2",
  accentBg: "rgba(94,106,210,0.15)",
  accentHover: "#7B85E0",

  // Status
  success: "#4ADE80",
  successBg: "rgba(74,222,128,0.12)",
  warning: "#FBBF24",
  warningBg: "rgba(251,191,36,0.12)",
  error: "#F87171",
  errorBg: "rgba(248,113,113,0.12)",
  info: "#60A5FA",
  infoBg: "rgba(96,165,250,0.12)",

  // Components
  headerBg: "#08090A",
  sidebarBg: "#08090A",
  cardBg: "#101112",
  cardBorder: "#23252A",
  tableLabelBg: "#101112",
  tableValueBg: "#161718",

  // Toggle / pill
  pillBg: "#161718",
  pillBorder: "#23252A",
  pillActiveBg: "#23252A",
  pillActiveText: "#F7F8F8",
  pillInactiveText: "#8A8F98",

  // Badges
  badgePurpleBg: "rgba(94,106,210,0.2)",
  badgePurpleText: "#A5ADFF",

  // Checkbox accent
  checkboxAccent: "#5E6AD2",

  // Shadows
  shadowSm: "0 1px 2px rgba(0,0,0,0.3)",
  shadowMd: "0 2px 8px rgba(0,0,0,0.4)",

  // Progress bar track
  progressTrack: "#23252A",

  // Stepper
  stepperLine: "#23252A",
  stepperLineComplete: "#4ADE80",

  // Hover
  hoverBg: "rgba(255,255,255,0.04)",

  // Link
  link: "#60A5FA",

  // Gate
  gateNogo: "#F87171",
  gateNogoBg: "rgba(248,113,113,0.12)",
  gateNogoBorder: "rgba(248,113,113,0.25)",
  gateGo: "#4ADE80",
  gateGoBg: "rgba(74,222,128,0.12)",

  // Scrollbar
  scrollbarThumb: "#23252A",
  scrollbarTrack: "transparent",
};

// ─── CONTEXT ─────────────────────────────────────────────────────────────────

const ThemeContext = createContext({ theme: FUSE, themeName: "fuse", setThemeName: () => {} });

const THEME_STORAGE_KEY = "solar-dcf-theme";

export function ThemeProvider({ children }) {
  const [themeName, setThemeName] = useState(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || "linear";
    } catch {
      return "linear";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeName);
    } catch {}
  }, [themeName]);

  const theme = themeName === "linear" ? LINEAR : FUSE;

  return (
    <ThemeContext.Provider value={{ theme, themeName, setThemeName }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export { FUSE, LINEAR };
