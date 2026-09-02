"use client";

// YouTube import entry on the create flow — design.md §4.5, development.md §5.
// Paste a link → extraction runs on the api (transcript + description → LLM) →
// the returned DRAFT pre-fills the unified editor below. Nothing is saved
// until the user reviews and saves (§5 step 5 — never auto-save).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Youtube } from "lucide-react";
import type { RecipeBlocks } from "@cookbook/shared";
import { api, ApiRequestError } from "@/lib/api";
import { quotaAwareOnError } from "@/components/llm-quota";
import { BentoCell } from "@/components/bento";

export function YouTubeImportPanel({ onDraft }: { onDraft: (blocks: RecipeBlocks) => void }) {
  const router = useRouter();
  const [url, setUrl] = useState("");

  const extract = useMutation({
    mutationFn: () => api.importYoutube(url.trim()),
    onSuccess: (draft) => {
      if (draft.existing_recipe_id) {
        // Already imported once — open the saved copy instead of duplicating.
        toast.success("Already imported — opening it");
        router.push(`/recipes/${draft.existing_recipe_id}`);
        return;
      }
      if (!draft.blocks) return;
      onDraft(draft.blocks);
      toast.success(`Extracted "${draft.blocks.title}" — review and save`);
    },
    onError: (err) => {
      quotaAwareOnError(err); // 429 llm_quota_exceeded → daily-AI banner
      const message =
        err instanceof ApiRequestError && err.message ? err.message : "Extraction failed — check your connection and retry";
      toast.error(
        err instanceof ApiRequestError && err.code === "no_recipe_content"
          ? `${message} — you can still type it in below`
          : message,
      );
    },
  });

  return (
    <BentoCell className="mb-4">
      <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h3)] font-semibold">
        Import from YouTube
      </h2>
      <p className="mt-0.5 text-[length:var(--text-meta)] text-(--color-text-secondary)">
        Paste a recipe video link — the AI reads the transcript and description, you review the result.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) extract.mutate();
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          aria-label="YouTube video link"
          inputMode="url"
          className="min-w-0 flex-1 rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) px-3 py-2 outline-none placeholder:text-(--color-border-strong)/50 focus:border-(--color-accent)"
        />
        <button
          type="submit"
          disabled={url.trim().length < 5 || extract.isPending}
          className="flex shrink-0 items-center gap-1.5 rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) px-3 py-2 font-medium hover:border-(--color-accent) disabled:opacity-50"
        >
          {extract.isPending ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <Youtube className="size-4" strokeWidth={1.5} />
          )}
          Extract
        </button>
      </form>

      {/* design.md §5 loading state — extraction can take a while on the free LLM tier */}
      {extract.isPending && (
        <p className="flex items-center gap-2 py-2 font-mono text-mono text-(--color-text-secondary)">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} />
          Reading the video… this can take up to a minute on the free AI tier.
        </p>
      )}
    </BentoCell>
  );
}
