// Branded loading animation — a spinning ring around an icon that cycles
// through our energy-asset types (solar, wind, battery, grid, data centres).
// Used app-wide in place of plain "Loading…" text.
//
// Usage: <EnergyLoader />            → full centered loader
//        <EnergyLoader size={40} />  → smaller

import { useEffect, useState } from "react";
import { Sun, Wind, BatteryCharging, Zap, Server } from "lucide-react";
import { useTheme } from "./ThemeContext.jsx";

const ICONS = [Sun, Wind, BatteryCharging, Zap, Server];

// Inject keyframes once (the app styles inline, so there's no global stylesheet).
let injected = false;
function injectKeyframes() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const s = document.createElement("style");
  s.id = "energy-loader-keyframes";
  s.textContent = `
    @keyframes energyPop  { 0%{opacity:0;transform:scale(0.6) translateY(4px);} 60%{opacity:1;} 100%{opacity:1;transform:scale(1) translateY(0);} }
    @keyframes energySpin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(s);
}

export default function EnergyLoader({ size = 56, interval = 280 }) {
  const { theme } = useTheme();
  const [i, setI] = useState(0);

  useEffect(() => {
    injectKeyframes();
    const id = setInterval(() => setI(p => (p + 1) % ICONS.length), interval);
    return () => clearInterval(id);
  }, [interval]);

  const Icon = ICONS[i];
  const accent = theme.accent;

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100%", width: "100%", minHeight: size + 8,
    }}>
      <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* badge backdrop */}
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: accent + "14", border: `1px solid ${accent}22` }} />
        {/* spinning ring — a partial arc that rotates continuously */}
        <div style={{ position: "absolute", inset: -3, borderRadius: "50%", border: "2.5px solid transparent", borderTopColor: accent, borderRightColor: accent, animation: "energySpin 0.9s linear infinite" }} />
        {/* cycling icon — keyed so the pop animation re-runs each change */}
        <Icon key={i} size={Math.round(size * 0.5)} color={accent} strokeWidth={1.75}
          style={{ position: "relative", animation: "energyPop 0.28s ease-out" }} />
      </div>
    </div>
  );
}
