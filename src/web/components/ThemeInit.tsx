import { useEffect } from "react";
import { useTheme } from "@stdui/react/theme";

const NEON_CYBER_THEME = {
  dark: {
    palette: {
      primary: "oklch(0.75 0.25 185)",
      secondary: "oklch(0.70 0.28 325)",
      success: "oklch(0.75 0.25 185)",
      danger: "oklch(0.70 0.28 325)",
      warning: "oklch(0.80 0.18 85)",
      info: "oklch(0.60 0.25 300)",
    },
    neutralHue: 230,
    neutralChroma: 0.02,
    surfaceTintStyle: "gradient3" as const,
  },
};

export function ThemeInit() {
  const { setOverrides, setMode } = useTheme();

  useEffect(() => {
    setMode("dark");
    setOverrides(NEON_CYBER_THEME);
  }, [setOverrides, setMode]);

  return null;
}
