import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: AuthLanding,
  head: () => ({
    meta: [
      { title: "still. — sign in" },
      { name: "description", content: "Sign in to still., the focus companion that remembers." },
    ],
  }),
});

function AuthLanding() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) navigate({ to: "/app" });
    });
    return () => { active = false; };
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/app` : undefined },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-[420px]">
        <h1 className="font-serif text-5xl tracking-tight text-foreground">still.</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          A focus companion that quietly remembers what you've done, and adapts
          to how you actually work.
        </p>

        {sent ? (
          <div className="mt-10 rounded-[var(--radius)] border border-border bg-card px-5 py-6">
            <p className="font-serif text-lg text-foreground">Check your inbox.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              We sent a magic link to <span className="text-foreground">{email}</span>. Click it to come in.
            </p>
            <button
              onClick={() => setSent(false)}
              className="mt-4 text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-10 space-y-3">
            <label className="block text-xs uppercase tracking-wider text-muted-foreground">email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@somewhere.com"
              className="w-full rounded-[var(--radius)] border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50 focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="submit"
              disabled={busy || !email}
              className="w-full rounded-[var(--radius)] bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "sending…" : "send magic link"}
            </button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </form>
        )}

        <p className="mt-12 text-xs text-muted-foreground/70 leading-relaxed">
          Everything is remembered so you don't have to. This holds the day together —
          it doesn't replace talking to someone about the louder stuff.
        </p>
      </div>
    </main>
  );
}
