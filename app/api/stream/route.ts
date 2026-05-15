import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_INTERVALS: Record<string, number> = {
  metrics:   3000,
  services:  3000,
  mikrotik:  5000,
  activity:  60000,
  speedtest: 300000,
  weather:   600000,
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
    intervals[key] = param ? Math.max(1000, parseInt(param, 10) || def) : def;
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
