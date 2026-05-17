import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Conservative defaults — the *arr stack + PiHole + qBit don't change
// rapidly enough to justify aggressive polling, and the aggregate request
// rate was crashing upstream containers on this user's TrueNAS setup.
// Combined with per-endpoint memoization in the services route, each
// upstream now sees minimal load.
const DEFAULT_INTERVALS: Record<string, number> = {
  metrics:   10000,
  services:  30000,
  mikrotik:  15000,
  activity:  120000,
  speedtest: 600000,
  weather:   600000,
};

// Floor each endpoint's poll interval so user overrides can't accidentally
// flood the homelab. These are the absolute minimums; the defaults above
// are what new installs see.
const MIN_INTERVALS: Record<string, number> = {
  metrics:   5000,
  services:  20000,
  mikrotik:  10000,
  activity:  60000,
  speedtest: 120000,
  weather:   60000,
};

const ENDPOINTS: Record<string, string> = {
  metrics:   "/api/metrics",
  services:  "/api/services",
  mikrotik:  "/api/mikrotik",
  activity:  "/api/activity",
  speedtest: "/api/speedtest",
  weather:   "/api/weather",
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const origin = req.nextUrl.origin;

  const intervals: Record<string, number> = {};
  for (const [key, def] of Object.entries(DEFAULT_INTERVALS)) {
    const param = searchParams.get(key);
    const requested = param ? (parseInt(param, 10) || def) : def;
    intervals[key] = Math.max(MIN_INTERVALS[key] ?? 1000, requested);
  }

  const encoder = new TextEncoder();
  let alive = true;

  const stream = new ReadableStream({
    start(controller) {
      const timers: ReturnType<typeof setInterval>[] = [];

      function send(event: string, data: unknown) {
        if (!alive) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          alive = false;
        }
      }

      async function fetchAndPush(key: string) {
        if (!alive) return;
        try {
          const res = await fetch(`${origin}${ENDPOINTS[key]}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) return;
          const data = await res.json();
          send(key, data);
        } catch { /* upstream down — skip this tick */ }
      }

      send("connected", { ts: Date.now() });

      for (const key of Object.keys(ENDPOINTS)) {
        fetchAndPush(key);
        timers.push(setInterval(() => fetchAndPush(key), intervals[key]));
      }

      const heartbeat = setInterval(() => {
        send("heartbeat", { ts: Date.now() });
      }, 30000);
      timers.push(heartbeat);

      (controller as unknown as { _cleanup: () => void })._cleanup = () => {
        alive = false;
        for (const t of timers) clearInterval(t);
      };
    },
    cancel(controller) {
      alive = false;
      const ctrl = controller as unknown as { _cleanup?: () => void };
      ctrl._cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
