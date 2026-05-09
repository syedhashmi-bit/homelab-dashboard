import { NextResponse } from "next/server";

const WEATHER_CODES: Record<number, string> = {
  0:  "sunny",
  1:  "mostly clear",
  2:  "partly cloudy",
  3:  "overcast",
  45: "foggy",
  48: "foggy",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "showers",
  81: "rain showers",
  82: "heavy showers",
  85: "snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm",
  99: "heavy thunderstorm",
};

// Coordinates default to Launceston, TAS — the original deployment's location.
// Override via WEATHER_LAT / WEATHER_LON env vars.
const LAT = process.env.WEATHER_LAT ?? "-41.4419";
const LON = process.env.WEATHER_LON ?? "147.1450";

export async function GET() {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code`,
      { next: { revalidate: 900 }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const temp: number | null = data?.current?.temperature_2m ?? null;
    // open-meteo migrated from weathercode → weather_code; accept both
    const code: number | null = data?.current?.weather_code ?? data?.current?.weathercode ?? null;
    const condition = code != null ? (WEATHER_CODES[code] ?? `code ${code}`) : null;
    return NextResponse.json({ temp, condition, code, timestamp: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
