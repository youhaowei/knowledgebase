import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { StduiProvider } from "@stdui/react/theme";
import appCss from "../web/styles.css?url";
import { NotFound } from "../web/components/NotFound";
import { ThemeInit } from "../web/components/ThemeInit";

export const Route = createRootRoute({
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Knowledgebase" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-void text-text-primary font-sans h-screen overflow-hidden flex flex-col">
        <StduiProvider defaultMode="dark" storageKey="kb">
          <ThemeInit />
          <div className="flex-1 relative w-full h-full">
            <Outlet />
          </div>
        </StduiProvider>
        <Scripts />
      </body>
    </html>
  );
}
