import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

// ── /api/bookmarks ──────────────────────────────────────────────────────────
// GET  → load current bookmarks (from data/bookmarks.json, then BOOKMARKS_PATH
//         fallback, then default)
// POST → save bookmarks to data/bookmarks.json (the writable mount)

interface BookmarkItem {
  name: string;
  url:  string;
  icon: string;   // URL or base64 data URI (capped at ~10kb by the frontend)
}

interface BookmarkColumn {
  title:       string;
  accentColor: string;
  items:       BookmarkItem[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_BOOKMARKS = path.join(DATA_DIR, "bookmarks.json");

let cache: { data: BookmarkColumn[]; ts: number } | null = null;
const CACHE_TTL = 10_000;

async function loadBookmarks(): Promise<BookmarkColumn[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;

  // Priority: data/bookmarks.json (writable) > BOOKMARKS_PATH > cwd/bookmarks.json > default
  const paths = [
    DATA_BOOKMARKS,
    process.env.BOOKMARKS_PATH,
    path.join(process.cwd(), "bookmarks.json"),
  ].filter(Boolean) as string[];

  for (const p of paths) {
    try {
      const raw = await fs.readFile(p, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cache = { data: parsed as BookmarkColumn[], ts: Date.now() };
        return parsed as BookmarkColumn[];
      }
    } catch { /* try next */ }
  }

  const fallback: BookmarkColumn[] = [
    { title: "Social", accentColor: "#06b6d4", items: [
      { name: "YouTube", url: "https://www.youtube.com", icon: "https://www.google.com/s2/favicons?domain=youtube.com&sz=32" },
      { name: "Reddit",  url: "https://www.reddit.com",  icon: "https://www.google.com/s2/favicons?domain=reddit.com&sz=32" },
    ]},
    { title: "Productivity", accentColor: "#10b981", items: [
      { name: "ChatGPT", url: "https://chat.openai.com", icon: "https://www.google.com/s2/favicons?domain=openai.com&sz=32" },
      { name: "Gmail",   url: "https://mail.google.com", icon: "https://www.google.com/s2/favicons?domain=gmail.com&sz=32" },
    ]},
  ];
  cache = { data: fallback, ts: Date.now() };
  return fallback;
}

export async function GET() {
  const bookmarks = await loadBookmarks();
  return NextResponse.json({ bookmarks });
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 }); }

  if (!body || typeof body !== "object" || !Array.isArray((body as { bookmarks?: unknown }).bookmarks)) {
    return NextResponse.json({ ok: false, message: "Body must have a `bookmarks` array" }, { status: 400 });
  }

  const bookmarks = (body as { bookmarks: unknown[] }).bookmarks;

  // Basic shape validation
  for (let i = 0; i < bookmarks.length; i++) {
    const col = bookmarks[i] as Record<string, unknown>;
    if (typeof col.title !== "string") return NextResponse.json({ ok: false, message: `bookmarks[${i}].title must be a string` }, { status: 400 });
    if (typeof col.accentColor !== "string") return NextResponse.json({ ok: false, message: `bookmarks[${i}].accentColor must be a string` }, { status: 400 });
    if (!Array.isArray(col.items)) return NextResponse.json({ ok: false, message: `bookmarks[${i}].items must be an array` }, { status: 400 });
    for (let j = 0; j < (col.items as unknown[]).length; j++) {
      const item = (col.items as Record<string, unknown>[])[j];
      if (typeof item.name !== "string") return NextResponse.json({ ok: false, message: `bookmarks[${i}].items[${j}].name must be a string` }, { status: 400 });
      if (typeof item.url !== "string") return NextResponse.json({ ok: false, message: `bookmarks[${i}].items[${j}].url must be a string` }, { status: 400 });
      if (typeof item.icon !== "string") return NextResponse.json({ ok: false, message: `bookmarks[${i}].items[${j}].icon must be a string` }, { status: 400 });
      // Cap base64 icons at ~15kb to keep config reasonable
      if (item.icon.startsWith("data:") && (item.icon as string).length > 20_000) {
        return NextResponse.json({ ok: false, message: `bookmarks[${i}].items[${j}].icon is too large (max ~10kb base64)` }, { status: 400 });
      }
    }
  }

  // Write to data/bookmarks.json
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = DATA_BOOKMARKS + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(bookmarks, null, 2), "utf8");
    await fs.rename(tmp, DATA_BOOKMARKS);
    cache = null; // invalidate
    return NextResponse.json({ ok: true, message: `Saved ${bookmarks.length} columns to ${DATA_BOOKMARKS}` });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Write failed: ${(e as Error).message}. Mount a writable volume at /app/data.` }, { status: 500 });
  }
}
