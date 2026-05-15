"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SSEHandler = (event: string, data: unknown) => void;

interface UseEventStreamOptions {
  enabled: boolean;
  intervals?: Record<string, number>;
  onMessage: SSEHandler;
}

export function useEventStream({ enabled, intervals, onMessage }: UseEventStreamOptions) {
  const [connected, setConnected] = useState(false);
  const [fallback, setFallback] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!enabled) return;

    const params = new URLSearchParams();
    if (intervals) {
      for (const [k, v] of Object.entries(intervals)) {
        params.set(k, String(v));
      }
    }

    const url = `/api/stream${params.toString() ? `?${params}` : ""}`;
    const es = new EventSource(url);
    esRef.current = es;

    const EVENTS = ["connected", "metrics", "services", "mikrotik", "activity", "speedtest", "weather", "heartbeat"];

    for (const evt of EVENTS) {
      es.addEventListener(evt, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (evt === "connected" || evt === "heartbeat") {
            setConnected(true);
            retriesRef.current = 0;
            return;
          }
          onMessageRef.current(evt, data);
        } catch { /* malformed data — skip */ }
      });
    }

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;
      retriesRef.current++;
      if (retriesRef.current >= 3) {
        setFallback(true);
      } else {
        const delay = Math.min(5000, 1000 * Math.pow(2, retriesRef.current));
        setTimeout(connect, delay);
      }
    };
  }, [enabled, intervals]);

  useEffect(() => {
    if (!enabled) {
      setFallback(true);
      return;
    }
    connect();
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect, enabled]);

  return { connected, fallback };
}
