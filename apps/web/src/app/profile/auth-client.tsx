"use client";

// Username-only auth (development.md §0 — identification on a trusted
// homeserver, not a security boundary).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiRequestError } from "@/lib/api";

export function AuthPanel() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: false,
  });

  const submit = async (mode: "login" | "signup") => {
    try {
      if (mode === "signup") await api.signup(username.trim());
      else await api.login(username.trim());
      await queryClient.invalidateQueries();
      toast.success(mode === "signup" ? `Welcome, ${username.trim()}!` : "Signed in");
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Something went wrong";
      toast.error(message);
    }
  };

  if (isLoading) return <p className="text-(--color-text-secondary)">…</p>;

  if (me) {
    return (
      <div className="rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell)">
        <p className="font-[family-name:var(--font-display)] font-semibold">
          Signed in as {me.display_name}
        </p>
        <p className="mt-1 text-[length:var(--text-meta)] text-(--color-text-secondary)">
          Set your diet preferences below to tune recommendations.
        </p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell)"
      onSubmit={(e) => {
        e.preventDefault();
        void submit("login");
      }}
    >
      <label className="text-[length:var(--text-meta)] font-medium text-(--color-text-secondary)">
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. chef_sam"
          autoComplete="username"
          className="mt-1 w-full rounded-(--radius-sm) border border-(--color-border) bg-(--color-bg) px-3 py-2 text-[length:var(--text-body)] text-(--color-text-primary) outline-none focus:border-(--color-accent)"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          className="flex-1 rounded-(--radius-sm) bg-(--color-accent) px-4 py-2 font-medium text-white hover:opacity-90"
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => void submit("signup")}
          className="flex-1 rounded-(--radius-sm) border border-(--color-border) px-4 py-2 font-medium hover:border-(--color-accent)"
        >
          Create account
        </button>
      </div>
    </form>
  );
}
