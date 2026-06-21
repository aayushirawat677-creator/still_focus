import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getPersonalization,
  getParkHistory,
  saveTask,
  markTaskComplete,
  logBlock,
  savePark,
  getMemoryLog,
} from "@/lib/hydra.functions";

export const Route = createFileRoute("/_authenticated/app")({
  component: StillApp,
  head: () => ({ meta: [{ title: "still." }] }),
});

function StillApp() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const showLogs = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("logs");

  const personalize = useServerFn(getPersonalization);
  const history = useServerFn(getParkHistory);
  const saveTaskFn = useServerFn(saveTask);
  const markDoneFn = useServerFn(markTaskComplete);
  const logBlockFn = useServerFn(logBlock);
  const saveParkFn = useServerFn(savePark);
  const memoryLogFn = useServerFn(getMemoryLog);

  const { data: p } = useQuery({
    queryKey: ["personalization"],
    queryFn: () => personalize(),
    staleTime: 30_000,
  });
  const { data: parks } = useQuery({
    queryKey: ["parks"],
    queryFn: () => history(),
    staleTime: 30_000,
  });

  const logQuery = useQuery({
    queryKey: ["memlog"],
    queryFn: () => memoryLogFn(),
    enabled: showLogs,
    refetchInterval: showLogs ? 2000 : false,
  });

  const [taskText, setTaskText] = useState("");
  const [activeTask, setActiveTask] = useState<{ id: string; text: string } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const saveTaskM = useMutation({
    mutationFn: (text: string) => saveTaskFn({ data: { text } }),
    onSuccess: (r) => {
      setActiveTask({ id: r.id, text: r.text });
      setTaskText("");
      qc.invalidateQueries({ queryKey: ["personalization"] });
    },
  });
  const completeTaskM = useMutation({
    mutationFn: (v: { id: string; text: string }) => markDoneFn({ data: { taskId: v.id, text: v.text } }),
    onSuccess: () => {
      setActiveTask(null);
      qc.invalidateQueries({ queryKey: ["personalization"] });
    },
  });
  const saveParkM = useMutation({
    mutationFn: (text: string) => saveParkFn({ data: { text } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parks"] });
      qc.invalidateQueries({ queryKey: ["personalization"] });
    },
  });
  const logBlockM = useMutation({
    mutationFn: (v: { durationMinutes: number; startedAt: string; completedAt: string }) =>
      logBlockFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["personalization"] }),
  });

  // Personalized hint above the task input
  const hint = useMemo(() => {
    if (!p) return null;
    if (!p.isReturning) return "First time here. What's the one thing?";
    if (p.stalledLongTasksHint) return p.stalledLongTasksHint;
    if (p.suggestedTask) return `Last time you wrote "${p.suggestedTask}". Try one like it.`;
    return "Welcome back. What's the one thing today?";
  }, [p]);

  function beginFocus() {
    if (!activeTask) return;
    setCountdown(5);
  }

  // Countdown overlay → starts timer when it hits "go"
  const [pendingStart, setPendingStart] = useState(false);
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      setPendingStart(true);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 900);
    return () => clearTimeout(t);
  }, [countdown]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  return (
    <main className="min-h-screen px-6 py-10 md:py-16 flex justify-center">
      <div className="w-full max-w-[540px]">
        {/* Header */}
        <header className="flex items-baseline justify-between">
          <h1 className="font-serif text-4xl text-foreground">still.</h1>
          <button onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground">
            sign out
          </button>
        </header>

        {/* Welcome-back stats line */}
        {p?.isReturning && (
          <p className="mt-2 text-xs text-muted-foreground">
            welcome back · {p.totalBlocks} {p.totalBlocks === 1 ? "block" : "blocks"} so far
            {p.todayBlocks > 0 ? ` · ${p.todayBlocks} today` : ""}
            {p.peakHourLine ? ` · ${p.peakHourLine.toLowerCase()}` : ""}
          </p>
        )}

        {/* Card 1: The one thing */}
        <section className="mt-10 rounded-[var(--radius)] border border-border bg-card p-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">the one thing</p>
          {hint && <p className="mt-2 font-serif italic text-foreground/85">{hint}</p>}

          {activeTask ? (
            <div className="mt-4 flex items-start gap-3">
              <div className="flex-1">
                <p className="font-serif text-lg text-foreground">{activeTask.text}</p>
              </div>
              <button
                onClick={() => completeTaskM.mutate({ id: activeTask.id, text: activeTask.text })}
                className="text-xs rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                done
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); if (taskText.trim()) saveTaskM.mutate(taskText); }}
              className="mt-4 flex gap-2"
            >
              <input
                value={taskText}
                onChange={(e) => setTaskText(e.target.value)}
                placeholder="say it plainly…"
                className="flex-1 rounded-[var(--radius)] border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50"
              />
              <button
                type="submit"
                disabled={!taskText.trim() || saveTaskM.isPending}
                className="rounded-[var(--radius)] bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                set
              </button>
            </form>
          )}
        </section>

        {/* Card 2: Begin */}
        <section className="mt-5 rounded-[var(--radius)] border border-border bg-card p-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">begin</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {activeTask ? "Five breaths, then start." : "Set the one thing first."}
          </p>
          <button
            disabled={!activeTask}
            onClick={beginFocus}
            className="mt-4 w-full rounded-[var(--radius)] bg-secondary px-4 py-3 text-sm font-medium text-secondary-foreground hover:bg-secondary/90 disabled:opacity-40"
          >
            begin
          </button>
        </section>

        {/* Card 3: Focus block */}
        <FocusBlock
          autoStart={pendingStart}
          onStarted={() => setPendingStart(false)}
          onComplete={(v) => logBlockM.mutate(v)}
          peakHourLine={p?.peakHourLine}
        />

        {/* Card 4: Park it */}
        <ParkCard
          onSave={(t) => saveParkM.mutate(t)}
          parks={parks ?? []}
          recurringTheme={p?.recurringParkTheme ?? null}
        />

        <DemoWalkthrough />

        <footer className="mt-12 text-xs text-muted-foreground/70 leading-relaxed">
          Everything is remembered so you don't have to. This holds the day together — it
          doesn't replace talking to someone about the louder stuff.
        </footer>

        {showLogs && (
          <section className="mt-8 rounded-[var(--radius)] border border-border bg-card p-4 text-[11px] font-mono">
            <p className="text-muted-foreground mb-2">HydraDB execution log (most recent first)</p>
            <ul className="space-y-1 max-h-72 overflow-auto">
              {(logQuery.data ?? []).map((e: any, i: number) => (
                <li key={i} className={e.error ? "text-destructive" : "text-foreground/80"}>
                  <span className="text-muted-foreground">{e.ts.slice(11, 19)}</span>{" "}
                  {e.method} {e.path} · {e.status} · {e.durationMs}ms
                  {e.summary ? ` · ${e.summary}` : ""}
                  {e.requestId ? ` · ${e.requestId.slice(0, 8)}` : ""}
                  {e.error ? ` · ${e.error}` : ""}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {countdown !== null && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex items-center justify-center">
          <span className="font-serif text-[12rem] leading-none text-foreground/90 select-none">
            {countdown > 0 ? countdown : "go."}
          </span>
        </div>
      )}
    </main>
  );
}

function FocusBlock({
  autoStart,
  onStarted,
  onComplete,
  peakHourLine,
}: {
  autoStart: boolean;
  onStarted: () => void;
  onComplete: (v: { durationMinutes: number; startedAt: string; completedAt: string }) => void;
  peakHourLine: string | null | undefined;
}) {
  const [duration, setDuration] = useState<15 | 25>(25);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState<number>(25 * 60);
  const startedRef = useRef<string | null>(null);
  const [justDone, setJustDone] = useState(false);

  useEffect(() => {
    if (autoStart) {
      onStarted();
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  function start() {
    setRemaining(duration * 60);
    startedRef.current = new Date().toISOString();
    setRunning(true);
    setJustDone(false);
  }
  function stop() {
    setRunning(false);
    startedRef.current = null;
  }

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(t);
          setRunning(false);
          if (startedRef.current) {
            onComplete({
              durationMinutes: duration,
              startedAt: startedRef.current,
              completedAt: new Date().toISOString(),
            });
          }
          startedRef.current = null;
          setJustDone(true);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running, duration, onComplete]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <section className="mt-5 rounded-[var(--radius)] border border-border bg-card p-6">
      <div className="flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">focus block</p>
        <div className="flex gap-1">
          {[15, 25].map((d) => (
            <button
              key={d}
              onClick={() => { setDuration(d as 15 | 25); if (!running) setRemaining(d * 60); }}
              className={`text-xs rounded-md px-2 py-1 ${duration === d ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              disabled={running}
            >
              {d}m
            </button>
          ))}
        </div>
      </div>

      <p className="mt-4 font-serif text-6xl tabular-nums text-foreground tracking-tight">{mm}:{ss}</p>

      {running ? (
        <>
          <p className="mt-2 text-xs text-muted-foreground">stand up, shake out the shoulders, then sit.</p>
          <button onClick={stop} className="mt-4 text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
            stop
          </button>
        </>
      ) : (
        <button
          onClick={start}
          className="mt-4 w-full rounded-[var(--radius)] border border-border bg-background px-4 py-2.5 text-sm text-foreground hover:bg-accent"
        >
          start {duration}m
        </button>
      )}

      {justDone && (
        <p className="mt-3 font-serif italic text-foreground/85">That's a rep.</p>
      )}
      {peakHourLine && !running && (
        <p className="mt-2 text-xs text-muted-foreground">{peakHourLine}</p>
      )}
    </section>
  );
}

function ParkCard({
  onSave,
  parks,
  recurringTheme,
}: {
  onSave: (text: string) => void;
  parks: { id: string; text: string; created_at: string }[];
  recurringTheme: string | null;
}) {
  const [text, setText] = useState("");
  return (
    <section className="mt-5 rounded-[var(--radius)] border border-border bg-card p-6">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">park it</p>
      <p className="mt-2 text-sm text-muted-foreground">whatever's pulling at you. leave it here.</p>
      <form
        onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSave(text); setText(""); } }}
        className="mt-3"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="press enter to park…"
          className="w-full rounded-[var(--radius)] border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50"
        />
      </form>

      {recurringTheme && (
        <p className="mt-4 font-serif italic text-secondary text-sm">{recurringTheme}</p>
      )}

      {parks.length > 0 && (
        <ul className="mt-4 space-y-2 max-h-56 overflow-auto pr-1">
          {parks.map((p) => (
            <li key={p.id} className="text-sm">
              <span className="text-foreground/90">{p.text}</span>
              <span className="ml-2 text-xs text-muted-foreground">{relTime(p.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function relTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function DemoWalkthrough() {
  const [open, setOpen] = useState(true);
  const steps = [
    {
      title: "1 · Set a small task and finish a block",
      body: "Type a short task (3–6 words) in “the one thing,” hit set, then begin → run a 15m block to the end. This seeds HydraDB with a task + a completed block.",
    },
    {
      title: "2 · Set one long, vague task and leave it",
      body: "Set another task with 8+ words (e.g. “rewrite the entire onboarding flow and fix the dashboard”). Don't mark it done. Repeat once more so two long tasks stall.",
    },
    {
      title: "3 · Park a recurring thought 3+ times",
      body: "In “park it,” jot the same nagging theme three times across sessions (e.g. “email mom”, “call mom back”, “mom's birthday”). HydraDB clusters them semantically.",
    },
    {
      title: "4 · Reload the page",
      body: "On reload, getPersonalization queries HydraDB and the top of the page changes: welcome-back line with block count, a stalled-tasks hint above the input, a suggested small task from your history, your peak focus hour, and a recurring-theme nudge in park it.",
    },
    {
      title: "Peek under the hood",
      body: "Add ?logs=1 to the URL to see every HydraDB ingest/query with status, duration, and request id.",
    },
  ];
  return (
    <section className="mt-5 rounded-[var(--radius)] border border-border bg-card p-6">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-xs uppercase tracking-wider text-muted-foreground">how to demo</span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <>
          <p className="mt-2 font-serif italic text-foreground/85">
            A 2-minute path to see returning-user personalization light up.
          </p>
          <ol className="mt-4 space-y-3">
            {steps.map((s) => (
              <li key={s.title} className="text-sm">
                <p className="text-foreground">{s.title}</p>
                <p className="mt-1 text-muted-foreground leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
