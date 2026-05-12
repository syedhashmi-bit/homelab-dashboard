import { NextResponse } from "next/server";
import { loadConfig } from "@/app/lib/server-config";

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

// Emoji mapping for weather codes — used by the forecast card
const WEATHER_EMOJI: Record<number, string> = {
  0: "☀️",   // ☀️
  1: "🌤️", // 🌤️
  2: "⛅",         // ⛅
  3: "☁️",   // ☁️
  45: "🌫️", // 🌫️
  48: "🌫️",
  51: "🌦️", // 🌦️
  53: "🌧️", // 🌧️
  55: "🌧️",
  61: "🌦️",
  63: "🌧️",
  65: "🌧️",
  71: "🌨️", // 🌨️
  73: "❄️",  // ❄️
  75: "❄️",
  77: "❄️",
  80: "🌦️",
  81: "🌧️",
  82: "🌧️",
  85: "🌨️",
  86: "🌨️",
  95: "⛈️",  // ⛈️
  96: "⛈️",
  99: "⛈️",
};

export interface ForecastDay {
  date:      string;   // "Mon", "Tue", etc.
  high:      number;
  low:       number;
  code:      number;
  condition: string;
  emoji:     string;
}

export async function GET() {
  try {
    const config = await loadConfig();
    const { lat, lon } = config.weather;

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
      `&forecast_days=4` +      // today + 3 days ahead
      `&timezone=auto`,
      { next: { revalidate: 900 }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // ── current conditions ──
    const temp: number | null = data?.current?.temperature_2m ?? null;
    const code: number | null = data?.current?.weather_code ?? data?.current?.weathercode ?? null;
    const condition = code != null ? (WEATHER_CODES[code] ?? `code ${code}`) : null;

    // ── 3-day forecast (skip today = index 0, take indices 1-3) ──
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const forecast: ForecastDay[] = [];
    const dailyDates:  string[] | undefined = data?.daily?.time;
    const dailyHighs:  number[] | undefined = data?.daily?.temperature_2m_max;
    const dailyLows:   number[] | undefined = data?.daily?.temperature_2m_min;
    const dailyCodes:  number[] | undefined = data?.daily?.weather_code;

    if (dailyDates && dailyHighs && dailyLows && dailyCodes) {
      for (let i = 1; i <= 3 && i < dailyDates.length; i++) {
        const d    = new Date(dailyDates[i] + "T00:00:00");
        const dc   = dailyCodes[i];
        forecast.push({
          date:      days[d.getDay()],
          high:      Math.round(dailyHighs[i]),
          low:       Math.round(dailyLows[i]),
          code:      dc,
          condition: WEATHER_CODES[dc] ?? `code ${dc}`,
          emoji:     WEATHER_EMOJI[dc] ?? "",
        });
      }
    }

    return NextResponse.json({ temp, condition, code, forecast, timestamp: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
