import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

const BACKUP_FILES = [
  "config.json",
  "custom-cards.json",
  "alerts.json",
];

export async function GET() {
  const bundle: Record<string, unknown> = {
    _meta: {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: "comexe",
    },
  };

  for (const file of BACKUP_FILES) {
    try {
      const content = await fs.readFile(path.join(DATA_DIR, file), "utf-8");
      bundle[file.replace(".json", "")] = JSON.parse(content);
    } catch {
      // file doesn't exist or isn't valid json — skip
    }
  }

  try {
    const bookmarksPath = process.env.BOOKMARKS_PATH ?? path.join(process.cwd(), "bookmarks.json");
    const content = await fs.readFile(bookmarksPath, "utf-8");
    bundle.bookmarks = JSON.parse(content);
  } catch {
    // no bookmarks file
  }

  try {
    const settingsKey = "comexe:settings";
    bundle._meta_note = `Client settings stored in localStorage key "${settingsKey}" — not included in server backup. Export from browser Settings panel.`;
  } catch { /* ignore */ }

  return NextResponse.json(bundle, {
    headers: {
      "Content-Disposition": `attachment; filename="comexe-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || body._meta?.app !== "comexe") {
      return NextResponse.json({ ok: false, message: "Invalid backup file — missing ComExe metadata" }, { status: 400 });
    }

    try {
      await fs.access(DATA_DIR);
    } catch {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }

    const restored: string[] = [];

    for (const file of BACKUP_FILES) {
      const key = file.replace(".json", "");
      if (body[key] && typeof body[key] === "object") {
        await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(body[key], null, 2), "utf-8");
        restored.push(file);
      }
    }

    if (body.bookmarks && Array.isArray(body.bookmarks)) {
      const bookmarksPath = process.env.BOOKMARKS_PATH ?? path.join(process.cwd(), "bookmarks.json");
      await fs.writeFile(bookmarksPath, JSON.stringify(body.bookmarks, null, 2), "utf-8");
      restored.push("bookmarks.json");
    }

    return NextResponse.json({ ok: true, restored, message: `Restored ${restored.length} file(s): ${restored.join(", ")}` });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Import failed: ${(e as Error).message}` }, { status: 500 });
  }
}
