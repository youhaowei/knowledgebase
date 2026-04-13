import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import appCss from "../web/styles.css?url";
import { NotFound } from "../web/components/NotFound";
import { ensureServerIndexerStarted } from "@/server/indexer";

// Boot the 60s reconciliation sweep eagerly on first SSR render, not just on
// the first MCP/server-function request. ensureServerIndexerStarted() bails
// on the client (`typeof window !== "undefined"`) so this is a no-op in the
// browser bundle. Idempotent — safe to invoke from multiple boot sites.
if (process.env.KB_DISABLE_SERVER_INDEXER !== "true") {
  ensureServerIndexerStarted();
}

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
        <div className="flex-1 relative w-full h-full">
          <Outlet />
        </div>
        <Scripts />
      </body>
    </html>
  );
}
