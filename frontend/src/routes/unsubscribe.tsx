import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, MailX } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";

type UnsubscribeSearch = {
  c?: string;
  e?: string;
  s?: string;
};

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: (search: Record<string, unknown>): UnsubscribeSearch => {
    const pick = (key: "c" | "e" | "s"): string | undefined => {
      const value = search[key];
      return typeof value === "string" && value.length > 0 ? value : undefined;
    };
    const result: UnsubscribeSearch = {};
    const c = pick("c");
    const e = pick("e");
    const s = pick("s");
    if (c !== undefined) result.c = c;
    if (e !== undefined) result.e = e;
    if (s !== undefined) result.s = s;
    return result;
  },
  head: () => ({
    meta: [{ title: "Unsubscribe — Email Campaign Manager" }],
  }),
  component: UnsubscribePage,
});

type Phase = "working" | "done" | "invalid" | "error";

function UnsubscribePage() {
  const { c, e, s } = Route.useSearch();
  const [phase, setPhase] = useState<Phase>("working");
  const [alreadyMessage, setAlreadyMessage] = useState<string | null>(null);

  const ran = useRef(false);
  useEffect(() => {
    // Guard against StrictMode double-invocation; the backend is idempotent
    // but the request should still fire once per real visit.
    if (ran.current) return;
    ran.current = true;
    void unsubscribe(c, e, s, setPhase, setAlreadyMessage);
  }, [c, e, s]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-[var(--shadow-soft)]">
        <div
          className={`mx-auto flex size-12 items-center justify-center rounded-full ${
            phase === "done"
              ? "bg-success/10 text-success"
              : phase === "working"
                ? "bg-primary/10 text-primary"
                : "bg-destructive/10 text-destructive"
          }`}
        >
          {phase === "done" ? (
            <CheckCircle2 className="size-6" />
          ) : phase === "working" ? (
            <Loader2 className="size-6 animate-spin" />
          ) : (
            <CircleAlert className="size-6" />
          )}
        </div>

        <h1 className="mt-4 text-xl font-semibold text-foreground">
          {phase === "done"
            ? "You're unsubscribed"
            : phase === "working"
              ? "Processing your request…"
              : "Can't unsubscribe from this link"}
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          {phase === "done"
            ? (alreadyMessage ??
              "You won't receive future email campaigns from this sender.")
            : phase === "working"
              ? "One moment while we update your email preferences."
              : phase === "invalid"
                ? "This unsubscribe link is invalid or has expired. If you keep receiving emails you don't want, contact the sender directly."
                : "Something went wrong on our side. Please try again in a moment."}
        </p>

        {phase === "done" ? (
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <MailX className="size-3.5" /> No further action is needed.
          </div>
        ) : null}
      </div>
    </div>
  );
}

async function unsubscribe(
  campaignId: string | undefined,
  email: string | undefined,
  signature: string | undefined,
  setPhase: (phase: Phase) => void,
  setAlreadyMessage: (message: string | null) => void
) {
  // Missing or malformed link parameters can never succeed — skip the call.
  if (!campaignId || !email || !signature) {
    setPhase("invalid");
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ campaignId, email, signature }),
    });

    if (res.ok) {
      setAlreadyMessage(
        email
          ? `The address ${email} won't receive future email campaigns from this sender.`
          : null
      );
      setPhase("done");
    } else if (res.status === 400) {
      setPhase("invalid");
    } else {
      setPhase("error");
    }
  } catch {
    setPhase("error");
  }
}
