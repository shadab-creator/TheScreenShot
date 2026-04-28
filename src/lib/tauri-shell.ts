import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";

const DESKTOP_ONLY =
  "Screen capture runs in the Tauri desktop app. From the project folder run `npm run tauri dev` (Rust required). Opening http://localhost:1420/ in a normal browser cannot access window or capture APIs.";

type TauriGlobals = {
  __TAURI_INTERNALS__?: {
    metadata?: { currentWindow?: { label?: string } };
  };
};

function shellReady(): boolean {
  if (typeof window === "undefined") return false;
  const g = window as unknown as TauriGlobals;
  return !!g.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Like {@link getCurrentWindow}, but avoids throwing when `__TAURI_INTERNALS__`
 * is missing (browser preview) or not ready yet (multi-window race).
 */
export async function getShellWindow(): Promise<TauriWindow> {
  if (!isTauri()) {
    throw new Error(DESKTOP_ONLY);
  }
  for (let i = 0; i < 50; i++) {
    if (shellReady()) {
      return getCurrentWindow();
    }
    await sleep(20);
  }
  throw new Error(
    "Tauri window metadata did not become available. Try restarting the app.",
  );
}
