import { isTauri } from "@tauri-apps/api/core";
import {
  BaseDirectory,
  mkdir,
  readFile,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import {
  base64ToBytes,
  bytesToBase64,
  type CaptureResult,
} from "./tauri";

const MAX_RECENTS = 10;
const INDEX_PATH = "recents/index.json";

export interface RecentItem {
  id: string;
  /** Path relative to AppLocalData, e.g. `recents/<id>.png` */
  file: string;
  width: number;
  height: number;
  createdAt: string;
}

interface IndexFile {
  items: RecentItem[];
}

export async function loadRecentsList(): Promise<RecentItem[]> {
  if (!isTauri()) return [];
  try {
    const raw = await readTextFile(INDEX_PATH, {
      baseDir: BaseDirectory.AppLocalData,
    });
    const data = JSON.parse(raw) as IndexFile;
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

export async function recentToCaptureResult(
  item: RecentItem,
): Promise<CaptureResult> {
  const bytes = await readFile(item.file, {
    baseDir: BaseDirectory.AppLocalData,
  });
  return {
    base64: bytesToBase64(bytes),
    width: item.width,
    height: item.height,
  };
}

/** Persist a new capture as the most recent; trims to 10 and deletes old files. */
export async function addRecentCapture(
  result: CaptureResult,
): Promise<RecentItem[]> {
  if (!isTauri()) return [];
  await mkdir("recents", {
    baseDir: BaseDirectory.AppLocalData,
    recursive: true,
  });

  const prev = await loadRecentsList();
  const id = crypto.randomUUID();
  const file = `recents/${id}.png`;
  await writeFile(file, base64ToBytes(result.base64), {
    baseDir: BaseDirectory.AppLocalData,
  });

  const newItem: RecentItem = {
    id,
    file,
    width: result.width,
    height: result.height,
    createdAt: new Date().toISOString(),
  };

  const next = [newItem, ...prev].slice(0, MAX_RECENTS);
  const keep = new Set(next.map((x) => x.id));
  for (const old of prev) {
    if (!keep.has(old.id)) {
      try {
        await remove(old.file, { baseDir: BaseDirectory.AppLocalData });
      } catch {
        /* ignore */
      }
    }
  }

  await writeTextFile(INDEX_PATH, JSON.stringify({ items: next }), {
    baseDir: BaseDirectory.AppLocalData,
  });
  return next;
}

export async function removeRecentItem(id: string): Promise<RecentItem[]> {
  if (!isTauri()) return [];
  const prev = await loadRecentsList();
  const item = prev.find((x) => x.id === id);
  const next = prev.filter((x) => x.id !== id);
  if (item) {
    try {
      await remove(item.file, { baseDir: BaseDirectory.AppLocalData });
    } catch {
      /* ignore */
    }
  }
  await writeTextFile(INDEX_PATH, JSON.stringify({ items: next }), {
    baseDir: BaseDirectory.AppLocalData,
  });
  return next;
}
