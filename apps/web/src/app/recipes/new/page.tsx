"use client";

import { useState } from "react";
import { TopAppBar, BottomTabBar } from "@/components/app-shell";
import { RecipeEditor } from "@/components/recipe-editor";
import { ImportPanel } from "@/components/import-panel";
import { YouTubeImportPanel } from "@/components/youtube-import-panel";
import type { MetaBlock, RecipeBlocks } from "@cookbook/shared";

// New recipe — starts directly in edit mode with the default block stack
// (design.md §3.3), or begins from a TheMealDB import (development.md §4) or
// a YouTube extraction (§5). Imported YouTube drafts pre-fill this same
// editor — the user reviews before anything is saved.
const emptyRecipe: RecipeBlocks = {
  title: "",
  description: null,
  hero_image_url: null,
  blocks: [
    {
      id: "meta",
      type: "meta",
      servings: 2,
      total_time_minutes: null,
      source_type: "manual",
      source_url: null,
    } satisfies MetaBlock,
  ],
};

export default function NewRecipePage() {
  // Keyed remount: an extracted YouTube draft replaces the whole block stack,
  // so the editor re-initializes from the new `initial` instead of merging.
  const [initial, setInitial] = useState<RecipeBlocks>(emptyRecipe);
  const [editorKey, setEditorKey] = useState(0);

  return (
    <div className="min-h-dvh pb-24">
      <TopAppBar title="New recipe" />
      <YouTubeImportPanel
        onDraft={(blocks) => {
          setInitial(blocks);
          setEditorKey((k) => k + 1);
        }}
      />
      <ImportPanel />
      <RecipeEditor key={editorKey} initial={initial} />
      <BottomTabBar />
    </div>
  );
}
