/**
 * Client-only StduiProvider wrapper.
 *
 * The StduiProvider uses zustand which needs React hooks.
 * When stdui is linked from a sibling project, SSR resolves
 * a different React copy causing "Invalid hook call".
 * By loading the provider only on the client, we avoid the dual-React SSR issue.
 */

import { useEffect, useState, type ReactNode } from "react";
import type { ThemeMode } from "@stdui/react/theme";

interface ThemeProviderProps {
  children: ReactNode;
}

interface WrappedProviderProps {
  children?: ReactNode;
}

interface ThemeProviderComponentProps extends WrappedProviderProps {
  defaultMode?: ThemeMode;
  storageKey?: string;
}

function createWrappedProvider(
  StduiProvider: React.ComponentType<ThemeProviderComponentProps>,
  ThemeInit: React.ComponentType,
) {
  return function WrappedProvider({ children }: WrappedProviderProps) {
    return (
      <StduiProvider defaultMode="dark" storageKey="kb">
        <ThemeInit />
        {children}
      </StduiProvider>
    );
  };
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [providerState, setProviderState] = useState<{
    Provider: React.ComponentType<ThemeProviderComponentProps>;
  } | null>(null);

  useEffect(() => {
    Promise.all([
      import("@stdui/react/theme"),
      import("./ThemeInit"),
    ]).then(([{ StduiProvider }, { ThemeInit }]) => {
      setProviderState({
        Provider: createWrappedProvider(StduiProvider, ThemeInit),
      });
    });
  }, []);

  // During SSR and before hydration, render children without theme provider
  // stdui components still work — they just use default tokens until the provider loads
  if (!providerState) return <>{children}</>;

  const { Provider } = providerState;

  // defaultMode/storageKey are intentionally NOT passed here — WrappedProvider
  // receives `{ children }` only and hardcodes the values on the real
  // StduiProvider inside createWrappedProvider. Passing them again here would
  // be a silent no-op and invite "why doesn't changing this do anything?"
  // bugs. Edit the values in createWrappedProvider instead.
  return <Provider>{children}</Provider>;
}
