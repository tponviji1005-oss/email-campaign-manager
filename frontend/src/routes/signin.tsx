import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Loader2, Send } from "lucide-react";
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

const trustPoints = [
  "Secure Google Authentication",
  "Your password is never stored by Email Campaign Manager",
  "Authentication is handled by Google OAuth 2.0",
];

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-[22px] shrink-0" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function SignInPage() {
  const [redirecting, setRedirecting] = useState(false);

  const handleGoogleSignIn = () => {
    if (redirecting) return;
    setRedirecting(true);
    window.location.href = googleSignInUrl();
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background via-background to-[#f1edff] px-4 py-10">
      <div className="w-full max-w-[450px] animate-in fade-in duration-700">
        <div className="rounded-[24px] border border-border bg-card/90 p-8 text-center shadow-[var(--shadow-lift)] backdrop-blur sm:p-10">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-primary to-[#8b5cf6] text-primary-foreground shadow-md shadow-primary/25">
            <Send className="size-6" />
          </span>

          <h1 className="mt-6 text-3xl font-bold tracking-tight text-foreground">
            Email Campaign Manager
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Securely create, validate and manage bulk email campaigns.
          </p>

          <Button
            size="lg"
            className="mt-8 h-12 w-full gap-2.5 rounded-xl text-[15px] font-semibold transition-all duration-200 [&_svg]:size-[22px]"
            onClick={handleGoogleSignIn}
            disabled={redirecting}
          >
            {redirecting ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
            {redirecting ? "Redirecting…" : "Continue with Google"}
          </Button>

          <div className="mt-8 space-y-3 border-t border-border pt-8 text-left">
            {trustPoints.map((point) => (
              <div key={point} className="flex items-start gap-3">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <p className="text-sm leading-snug text-muted-foreground">{point}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-3 text-sm text-muted-foreground">
          <a href="#" className="transition-colors hover:text-foreground">
            Privacy Policy
          </a>
          <span className="text-border">·</span>
          <a href="#" className="transition-colors hover:text-foreground">
            Terms of Service
          </a>
        </div>
      </div>
    </div>
  );
}
