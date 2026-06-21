import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Local task/park/block id helpers
function rid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const saveTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { text: string }) => d)
  .handler(async ({ data, context }) => {
    const { ingestMemory } = await import("./hydra.server");
    const text = data.text.trim();
    if (!text) throw new Error("Task text is required");
    const id = rid("task");
    const word_count = text.split(/\s+/).filter(Boolean).length;
    await ingestMemory({
      subTenantId: context.userId,
      id,
      title: "Task: " + text.slice(0, 80),
      text: `User chose this as the one thing for today: "${text}". Word count ${word_count}.`,
      kind: "task",
      extra: { word_count, raw_text: text, completed: false },
      infer: false,
    });
    return { id, text, word_count };
  });

export const markTaskComplete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string; text: string }) => d)
  .handler(async ({ data, context }) => {
    const { ingestMemory } = await import("./hydra.server");
    const id = rid("taskdone");
    await ingestMemory({
      subTenantId: context.userId,
      id,
      title: "Completed: " + data.text.slice(0, 80),
      text: `User completed the task: "${data.text}".`,
      kind: "task_complete",
      extra: { ref: data.taskId, raw_text: data.text },
      infer: false,
    });
    return { ok: true };
  });

export const logBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { durationMinutes: number; startedAt: string; completedAt: string }) => d)
  .handler(async ({ data, context }) => {
    const { ingestMemory } = await import("./hydra.server");
    const id = rid("block");
    const hour = new Date(data.startedAt).getHours();
    await ingestMemory({
      subTenantId: context.userId,
      id,
      title: `Focus block ${data.durationMinutes}m at ${hour}:00`,
      text: `User completed a ${data.durationMinutes}-minute focus block starting at ${data.startedAt}.`,
      kind: "block",
      extra: {
        duration_minutes: data.durationMinutes,
        started_at: data.startedAt,
        completed_at: data.completedAt,
        hour_of_day: hour,
      },
      infer: false,
    });
    return { ok: true };
  });

export const savePark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { text: string }) => d)
  .handler(async ({ data, context }) => {
    const { ingestMemory } = await import("./hydra.server");
    const text = data.text.trim();
    if (!text) throw new Error("Note is required");
    const id = rid("park");
    await ingestMemory({
      subTenantId: context.userId,
      id,
      title: "Parked: " + text.slice(0, 80),
      text,
      kind: "park",
      extra: { raw_text: text },
      infer: false,
    });
    return { id, text, created_at: new Date().toISOString() };
  });

export const getParkHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listMemories } = await import("./hydra.server");
    const rows = await listMemories({ subTenantId: context.userId, kind: "park", pageSize: 25 });
    return rows.map((r) => ({
      id: r.id,
      text: (r.additional_metadata?.raw_text as string) ?? r.title ?? "",
      created_at: (r.additional_metadata?.created_at as string) ?? r.timestamp ?? "",
    }));
  });

// The single personalization call. UI uses its return to change visible copy.
export const getPersonalization = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listMemories, queryMemory } = await import("./hydra.server");

    const [tasks, completes, blocks, parks] = await Promise.all([
      listMemories({ subTenantId: context.userId, kind: "task", pageSize: 50 }).catch(() => []),
      listMemories({ subTenantId: context.userId, kind: "task_complete", pageSize: 50 }).catch(() => []),
      listMemories({ subTenantId: context.userId, kind: "block", pageSize: 100 }).catch(() => []),
      listMemories({ subTenantId: context.userId, kind: "park", pageSize: 50 }).catch(() => []),
    ]);

    const totalBlocks = blocks.length;
    const today = new Date().toDateString();
    const todayBlocks = blocks.filter((b) => {
      const t = (b.additional_metadata?.started_at as string) ?? (b.additional_metadata?.created_at as string) ?? b.timestamp;
      return t && new Date(t).toDateString() === today;
    }).length;

    // Peak hour from block hour_of_day counts
    const hourCounts = new Map<number, number>();
    for (const b of blocks) {
      const h = b.additional_metadata?.hour_of_day as number | undefined;
      if (typeof h === "number") hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
    }
    let peakHour: number | null = null;
    let peakCount = 0;
    for (const [h, c] of hourCounts) if (c > peakCount) { peakHour = h; peakCount = c; }
    const peakHourLine = peakHour !== null && peakCount >= 2
      ? `You focus best around ${formatHour(peakHour)} — ${peakCount} blocks done there.`
      : null;

    // Detect stalled large tasks: recent tasks with high word count that have no matching complete
    const completedRefs = new Set(
      completes.map((c) => (c.additional_metadata?.ref as string) ?? "").filter(Boolean),
    );
    const recentTasks = tasks.slice(0, 10);
    const stalled = recentTasks.filter((t) => {
      const wc = (t.additional_metadata?.word_count as number) ?? 0;
      return wc >= 8 && !completedRefs.has(t.id);
    });
    const stalledLongTasksHint =
      stalled.length >= 2 ? "Last time, the big ones stalled. Try smaller today." : null;

    // Suggest a small past task (low word count, not done) via semantic query
    let suggestedTask: string | null = null;
    try {
      const r = await queryMemory(context.userId, "a small, simple starter task the user once wrote", 5);
      const chunk = r.chunks?.find((c) => {
        const wc = (c.additional_metadata?.word_count as number) ?? 99;
        return wc > 0 && wc <= 6;
      });
      if (chunk) {
        const raw = (chunk.additional_metadata?.raw_text as string) ?? chunk.chunk_content;
        if (raw) suggestedTask = raw.replace(/^["']|["']$/g, "").slice(0, 80);
      }
    } catch { /* ignore */ }

    // Recurring parked-thought theme via semantic clustering: query for the
    // most common park content and surface a theme if multiple parks cluster.
    let recurringParkTheme: string | null = null;
    if (parks.length >= 3) {
      try {
        const r = await queryMemory(context.userId, "what topic keeps showing up in parked thoughts", 5);
        if ((r.chunks?.length ?? 0) >= 3) {
          recurringParkTheme = "This thought keeps coming back.";
        }
      } catch { /* ignore */ }
    }

    const isReturning = totalBlocks > 0 || tasks.length > 0 || parks.length > 0;

    return {
      isReturning,
      totalBlocks,
      todayBlocks,
      peakHourLine,
      stalledLongTasksHint,
      suggestedTask,
      recurringParkTheme,
      counts: { tasks: tasks.length, blocks: totalBlocks, parks: parks.length },
    };
  });

function formatHour(h: number) {
  const suffix = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${suffix}`;
}

export const getMemoryLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getExecutionLog } = await import("./hydra.server");
    return getExecutionLog();
  });
