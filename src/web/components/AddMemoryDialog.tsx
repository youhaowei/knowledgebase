import { useEffect, useRef, useState } from "react";
import { addMemory } from "@/server/functions";

interface AddMemoryDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  namespace?: string;
  namespaces: string[];
}

export function AddMemoryDialog({ open, onClose, onAdded, namespace, namespaces }: AddMemoryDialogProps) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [selectedNs, setSelectedNs] = useState(namespace ?? "default");
  const [origin, setOrigin] = useState<"manual" | "retro" | "mcp" | "import">("manual");
  const [tags, setTags] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Resync namespace when the dialog opens — without this, switching the
  // top-bar namespace and then opening "Add" silently writes to whichever
  // namespace was selected when the dialog first mounted.
  useEffect(() => {
    if (open) {
      setSelectedNs(namespace ?? "default");
      // Autofocus first field; restoring focus on close is the parent's job.
      firstFieldRef.current?.focus();
    }
  }, [open, namespace]);

  // Escape closes; backdrop click already does. Without this, keyboard-only
  // users have no way to dismiss.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setIsSubmitting(true);
    setMessage(null);
    try {
      const result = await addMemory({
        data: {
          text: text.trim(),
          name: name.trim() || undefined,
          namespace: selectedNs,
          origin,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        },
      });
      setMessage({ type: "success", text: result.message });
      setText("");
      setName("");
      setOrigin("manual");
      setTags("");
      setTimeout(() => {
        onAdded();
        onClose();
        setMessage(null);
      }, 1000);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to add" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" role="dialog" aria-modal="true" aria-labelledby="add-memory-title">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-lg mx-4 rounded-xl bg-neutral-bg border border-neutral-border shadow-2xl animate-in">
        <div className="px-5 py-4 border-b border-neutral-border">
          <h2 id="add-memory-title" className="text-sm font-display font-semibold text-neutral-fg">Add Memory</h2>
          <p className="text-xs text-neutral-fg-subtle mt-0.5">
            Add new knowledge to be extracted into entities and facts
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Name (optional) */}
          <div>
            <label className="text-[11px] font-medium text-neutral-fg-subtle uppercase tracking-wider">
              Name (optional)
            </label>
            <input
              ref={firstFieldRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Architecture Decision - State Management"
              className="mt-1 w-full h-8 rounded-md bg-neutral-bg-subtle border border-neutral-border px-2.5 text-xs text-neutral-fg placeholder:text-neutral-fg-subtle/50 focus:border-palette-primary focus:outline-none"
            />
          </div>

          {/* Text */}
          <div>
            <label className="text-[11px] font-medium text-neutral-fg-subtle uppercase tracking-wider">
              Content
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter knowledge to extract..."
              rows={5}
              className="mt-1 w-full rounded-md bg-neutral-bg-subtle border border-neutral-border px-2.5 py-2 text-xs text-neutral-fg placeholder:text-neutral-fg-subtle/50 focus:border-palette-primary focus:outline-none resize-none"
            />
          </div>

          {/* Namespace */}
          <div>
            <label className="text-[11px] font-medium text-neutral-fg-subtle uppercase tracking-wider">
              Namespace
            </label>
            <select
              value={selectedNs}
              onChange={(e) => setSelectedNs(e.target.value)}
              className="mt-1 w-full h-8 rounded-md bg-neutral-bg-subtle border border-neutral-border px-2 text-xs text-neutral-fg focus:border-palette-primary focus:outline-none"
            >
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
              {!namespaces.includes("default") && (
                <option value="default">default</option>
              )}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11px] font-medium text-neutral-fg-subtle uppercase tracking-wider">
                Origin
              </label>
              {/* Web UI only exposes user-originated origins. `mcp` is reserved
                  for the MCP tool handler, `retro` for the retro CLI — letting
                  users pick them from the dialog pollutes analytics with
                  mislabeled origins. */}
              <select
                value={origin}
                onChange={(e) => setOrigin(e.target.value as typeof origin)}
                className="mt-1 w-full h-8 rounded-md bg-neutral-bg-subtle border border-neutral-border px-2 text-xs text-neutral-fg focus:border-palette-primary focus:outline-none"
              >
                <option value="manual">manual</option>
                <option value="import">import</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-neutral-fg-subtle uppercase tracking-wider">
                Tags
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comma, separated, tags"
                className="mt-1 w-full h-8 rounded-md bg-neutral-bg-subtle border border-neutral-border px-2.5 text-xs text-neutral-fg placeholder:text-neutral-fg-subtle/50 focus:border-palette-primary focus:outline-none"
              />
              {/* Show the normalized tag set so the user sees what will be
                  saved. Server-side normalizeTags lowercases + trims; showing
                  chips here prevents "why did my tags change?" surprises. */}
              {tags.trim() && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {Array.from(new Set(
                    tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
                  )).map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-bg-subtle border border-neutral-border text-neutral-fg-subtle"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Message */}
          {message && (
            <div className={`text-xs px-3 py-2 rounded-md ${
              message.type === "success"
                ? "bg-palette-success/10 text-palette-success"
                : "bg-palette-danger/10 text-palette-danger"
            }`}>
              {message.text}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-neutral-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-neutral-bg-subtle border border-neutral-border text-xs text-neutral-fg hover:bg-neutral-bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !text.trim()}
            className="px-3 py-1.5 rounded-md bg-palette-primary text-white text-xs font-medium disabled:opacity-50 hover:bg-palette-primary/90"
          >
            {isSubmitting ? "Adding..." : "Add Memory"}
          </button>
        </div>
      </div>
    </div>
  );
}
