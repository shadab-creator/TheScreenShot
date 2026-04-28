import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  captureFocusedWindow,
  captureFullscreen,
  prepareRegionOverlay,
  type CaptureResult,
} from "./lib/tauri";
import { currentMonitor } from "@tauri-apps/api/window";
import { getShellWindow } from "./lib/tauri-shell";
import {
  addRecentCapture,
  loadRecentsList,
  removeRecentItem,
  type RecentItem,
} from "./lib/recents";
import { PreviewModal } from "./components/PreviewModal";
import { RecentScreenshots } from "./components/RecentScreenshots";

export function App() {
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [windowCaptureSec, setWindowCaptureSec] = useState<number | null>(null);

  useEffect(() => {
    void loadRecentsList().then(setRecents);
  }, []);

  const onFullscreen = useCallback(async () => {
    setError("");
    setStatus("Capturing…");
    setBusy(true);
    try {
      // Hide main window briefly so it doesn't appear in its own shot.
      const win = await getShellWindow();
      const mon = await currentMonitor();
      await win.hide();
      await new Promise((r) => setTimeout(r, 320));
      const hint =
        mon != null
          ? {
              x: mon.position.x,
              y: mon.position.y,
              width: mon.size.width,
              height: mon.size.height,
            }
          : null;
      const r = await captureFullscreen(hint);
      await win.show();
      await win.setFocus();
      setResult(r);
      void addRecentCapture(r).then(setRecents);
      setStatus("");
    } catch (e) {
      setError(String(e));
      setStatus("");
      try {
        const w = await getShellWindow();
        await w.show();
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const onRegion = useCallback(async () => {
    setError("");
    setStatus("Select a region…");
    try {
      await prepareRegionOverlay();
      const overlay = await WebviewWindow.getByLabel("overlay");
      if (overlay) {
        await overlay.show();
        await overlay.setFocus();
      }
    } catch (e) {
      setError(String(e));
      setStatus("");
    }
  }, []);

  const onCaptureActiveWindow = useCallback(() => {
    setError("");
    setWindowCaptureSec(3);
    setStatus("Switch to the window you want… 3");
  }, []);

  useEffect(() => {
    if (windowCaptureSec === null) return;
    setStatus(`Switch to the window you want… ${windowCaptureSec}`);
  }, [windowCaptureSec]);

  useEffect(() => {
    if (windowCaptureSec === null) return;
    const id = window.setTimeout(() => {
      setWindowCaptureSec((prev) => {
        if (prev === null || prev <= 1) {
          if (prev === 1) {
            queueMicrotask(() => {
              void (async () => {
                setBusy(true);
                try {
                  const r = await captureFocusedWindow();
                  setResult(r);
                  void addRecentCapture(r).then(setRecents);
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                  setStatus("");
                }
              })();
            });
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearTimeout(id);
  }, [windowCaptureSec]);

  useEffect(() => {
    const unlistenCap = listen<CaptureResult>("screenshot-captured", (evt) => {
      setResult(evt.payload);
      void addRecentCapture(evt.payload).then(setRecents);
      setStatus("");
      setError("");
      void (async () => {
        try {
          const w = await getShellWindow();
          await w.show();
          await w.setFocus();
        } catch {
          /* ignore */
        }
      })();
    });
    const unlistenErr = listen<string>("screenshot-error", (evt) => {
      setError(evt.payload);
      setStatus("");
    });
    return () => {
      void unlistenCap.then((fn) => fn());
      void unlistenErr.then((fn) => fn());
    };
  }, []);

  const shortcutKey = isMac() ? "⌘" : "Ctrl";

  return (
    <div className="app">
      <div>
        <h1>TheScreenShot</h1>
        <div className="subtitle">
          Minimal cross-platform screenshot tool.
        </div>
      </div>

      <div className="actions">
        <button
          className="primary"
          onClick={onFullscreen}
          disabled={busy || windowCaptureSec !== null}
        >
          Capture Full Screen
        </button>
        <button
          type="button"
          onClick={onCaptureActiveWindow}
          disabled={busy || windowCaptureSec !== null}
        >
          {windowCaptureSec !== null
            ? `Window… ${windowCaptureSec}s`
            : "Capture Active Window"}
        </button>
        <button onClick={onRegion} disabled={busy || windowCaptureSec !== null}>
          Capture Region
        </button>
      </div>

      <div className="hint">
        Global shortcut:&nbsp;
        <kbd>{shortcutKey}</kbd>
        <span>+</span>
        <kbd>Shift</kbd>
        <span>+</span>
        <kbd>S</kbd>
      </div>

      <div className={`status${error ? " error" : ""}`}>
        {error || status}
      </div>

      <RecentScreenshots
        items={recents}
        onEdit={(cap) => {
          setError("");
          setResult(cap);
        }}
        onRemove={(id) => {
          void removeRecentItem(id).then(setRecents);
        }}
        onNotify={(msg) => {
          setStatus(msg);
          setTimeout(() => setStatus(""), 2500);
        }}
        onError={(msg) => setError(msg)}
      />

      {result && (
        <PreviewModal
          result={result}
          onClose={() => setResult(null)}
          onDelete={() => setResult(null)}
          onReplaceResult={(r) => {
            setResult(r);
          }}
          onNotify={(msg) => {
            setStatus(msg);
            setTimeout(() => setStatus(""), 2500);
          }}
          onError={(msg) => setError(msg)}
        />
      )}
    </div>
  );
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}
