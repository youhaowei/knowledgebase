/**
 * Client-only StduiProvider wrapper.
 *
 * The StduiProvider uses zustand which needs React hooks.
 * When stdui is linked from a sibling project, SSR resolves
 * a different React copy causing "Invalid hook call".
 * By loading the provider only on the client, we avoid the dual-React SSR issue.
 */

import { useEffect, useState, type ReactNode } from "react";

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [Provider, setProvider] = useState<React.ComponentType<{
    defaultMode: string;
    storageKey: string;
    children: ReactNode;
  }> | null>(null);

  useEffect(() => {
    Promise.all([
      import("@stdui/react/theme"),
      import("./ThemeInit"),
    ]).then(([{ StduiProvider }, { ThemeInit }]) => {
      // Wrap children with both provider and theme init
      setProvider(() => {
        return function WrappedProvider({ children: c }: { children: ReactNode }) {
          return (
            <StduiProvider defaultMode="dark" storageKey="kb">
              <ThemeInit />
              {c}
            </StduiProvider>
          );
        };
      });
    });
  }, []);

  // During SSR and before hydration, render children without theme provider
  // stdui components still work — they just use default tokens until the provider loads
  if (!Provider) return <>{children}</>;

  return (
    <Provider defaultMode="dark" storageKey="kb">
      {children}
    </Provider>
  );
}
