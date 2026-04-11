declare module "@stdui/react/theme" {
  import type { ComponentType, ReactNode } from "react";

  export type ThemeMode = "system" | "light" | "dark";

  export interface ThemeOverrides {
    [key: string]: unknown;
  }

  export interface StduiProviderProps {
    children?: ReactNode;
    defaultMode?: ThemeMode;
    storageKey?: string;
  }

  export const StduiProvider: ComponentType<StduiProviderProps>;

  export function useTheme(): {
    setMode: (mode: ThemeMode) => void;
    setOverrides: (overrides: ThemeOverrides) => void;
  };
}
