import { TopAppBar, BottomTabBar } from "@/components/app-shell";
import { AuthPanel } from "./auth-client";
import { DietProfileForm } from "./diet-profile-form";

// Profile / Diet Preferences — design.md §3.7. Username auth (§0) plus the
// diet-profile form that feeds the recommendation engine (development.md §10).
export default function ProfilePage() {
  return (
    <div className="min-h-dvh pb-20">
      <TopAppBar title="Profile" />
      <main className="mx-auto max-w-3xl px-(--spacing-margin) pt-(--spacing-margin)">
        <AuthPanel />
        <div className="mt-6">
          <DietProfileForm />
        </div>
      </main>
      <BottomTabBar />
    </div>
  );
}
