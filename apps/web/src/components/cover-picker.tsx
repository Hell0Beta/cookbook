"use client";

// Recipe cover art — design.md §3.3 cover block + §5 placeholders.
// Three sources (user request 2026-08-30): device gallery, camera, and the
// vendored Icons8 food-icon library (apps/web/public/icons — no network, §0).
// Photo covers upload through POST /images; icon covers reference the static
// path directly (30px PNGs render centered on a tinted tile, never stretched).
import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, ImagePlus, Trash2, X } from "lucide-react";
import { api, apiAsset, ApiRequestError } from "@/lib/api";import { ICON_CATEGORIES, ICON_LIBRARY, ICON_URL } from "@/lib/icon-library";
import { cn } from "@/lib/utils";

const MAX_BYTES = 10 * 1024 * 1024; // matches the images route's limit
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Icon-library covers are static /icons/* paths, not uploaded files. */
export const isIconCover = (url: string) => url.startsWith("/icons/");

/**
 * Renders a recipe cover anywhere it appears (reader, cards, thumbs).
 * `className` sizes the box and should carry border/rounded; the photo fills
 * with object-cover, an icon centers at a modest size on a tinted tile.
 */
export function RecipeCover({ url, className }: { url: string | null; className?: string }) {
  if (!url) return <div className={cn("hatch", className)} />;
  if (isIconCover(url)) {
    return (
      <div className={cn("flex items-center justify-center bg-(--color-surface-container)", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className={cn("object-contain", url.includes("-48") ? "size-10" : "size-8")} />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={apiAsset(url)} alt="" className={cn("object-cover", className)} />;
}

// ── picker modal (bottom-sheet, design.md §3.4 modal style) ─────────────────

export function CoverPickerModal({
  currentUrl,
  onSelect,
  onClose,
}: {
  currentUrl: string | null;
  onSelect: (url: string | null) => void;
  onClose: () => void;
}) {
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!ALLOWED_TYPES.has(file.type)) {
        throw new Error("That file type isn't supported — use JPG, PNG, WebP or GIF");
      }
      if (file.size > MAX_BYTES) throw new Error("That image is over 10 MB");
      return api.uploadImage(file);
    },
    onSuccess: ({ url }) => {
      onSelect(url);
      onClose();
    },
    onError: (err) =>
      toast.error(
        err instanceof Error && !(err instanceof ApiRequestError) ? err.message : "Upload failed — try again",
      ),
  });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = ""; // allow re-picking the same file
  };

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/30 p-(--spacing-margin) sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold">
            Recipe cover
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-(--color-text-secondary)">
            <X className="size-4" />
          </button>
        </div>

        {/* Source actions — gallery + camera. `capture` opens the camera on
            mobile; desktop browsers fall back to the file picker. */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => galleryInput.current?.click()}
            disabled={upload.isPending}
            className="flex items-center justify-center gap-2 rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) px-3 py-3 font-medium hover:border-(--color-accent) disabled:opacity-50"
          >
            <ImagePlus className="size-4" strokeWidth={1.5} />
            {upload.isPending ? "Uploading…" : "Gallery"}
          </button>
          <button
            type="button"
            onClick={() => cameraInput.current?.click()}
            disabled={upload.isPending}
            className="flex items-center justify-center gap-2 rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) px-3 py-3 font-medium hover:border-(--color-accent) disabled:opacity-50"
          >
            <Camera className="size-4" strokeWidth={1.5} />
            Take photo
          </button>
          <input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={onFile} />
          <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" hidden onChange={onFile} />
        </div>

        <p className="mb-2 font-mono text-mono uppercase tracking-wide text-(--color-text-secondary)">
          Or pick an icon
        </p>
        <div className="flex-1 overflow-y-auto pr-1">
          {ICON_CATEGORIES.map((category) => {
            const icons = ICON_LIBRARY.filter((i) => i.category === category);
            if (icons.length === 0) return null;
            const mono = icons.filter((i) => i.variant === "mono");
            const color = icons.filter((i) => i.variant === "color");
            return (
              <section key={category} className="mb-4 last:mb-0">
                <h3 className="sticky top-0 bg-(--color-surface) py-1 font-mono text-mono uppercase tracking-wide text-(--color-text-secondary)">
                  {category}
                </h3>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {[...mono, ...color].map((icon) => {
                    const selected = currentUrl === ICON_URL(icon.file);
                    return (
                      <button
                        key={icon.file}
                        type="button"
                        title={icon.label}
                        aria-label={icon.label}
                        onClick={() => {
                          onSelect(ICON_URL(icon.file));
                          onClose();
                        }}
                        className={cn(
                          "flex aspect-square items-center justify-center rounded-(--radius-sm) border bg-(--color-page) hover:border-(--color-accent)",
                          selected ? "border-(--color-accent)" : "border-(--color-border)",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ICON_URL(icon.file)} alt="" className={icon.variant === "color" ? "size-10" : "size-8"} />
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {currentUrl && (
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              onClose();
            }}
            className="mt-3 flex items-center justify-center gap-1.5 rounded-(--radius-sm) border border-(--color-error)/40 px-3 py-2 text-[length:var(--text-meta)] font-medium text-(--color-error) hover:bg-(--color-error)/5"
          >
            <Trash2 className="size-3.5" /> Remove cover
          </button>
        )}
      </div>
    </div>
  );
}
