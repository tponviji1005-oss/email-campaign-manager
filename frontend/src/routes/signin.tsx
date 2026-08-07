import { createFileRoute } from "@tanstack/react-router";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { googleSignInUrl } from "@/lib/api";

export const Route = createFileRoute("/signin")({
  head: () => ({
    meta: [
      { title: "Sign in — Email Campaign Manager" },
      { name: "description", content: "Sign in with Google to manage your email campaigns." },
    ],
  }),
  component: SignInPage,
});

function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-accent/40 px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-[var(--shadow-soft)]">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <Send className="size-6" />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-foreground">
          Email Campaign Manager
        </h1>

        <Button asChild size="lg" className="mt-8 h-12 w-full rounded-xl">
          <a href={googleSignInUrl()}>
            <svg viewBox="0 0 24 24" className="mr-2 size-5" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.35 11.1H12v2.9h5.35c-.23 1.4-1.65 4.1-5.35 4.1a5.9 5.9 0 1 1 0-11.8c1.68 0 2.8.72 3.44 1.33l2.35-2.26C16.34 3.9 14.4 3 12 3a9 9 0 1 0 0 18c5.2 0 8.63-3.65 8.63-8.8 0-.6-.06-1.03-.28-1.1Z"
              />
            </svg>
            Continue with Google
          </a>
        </Button>
      </div>
    </div>
  );
}
