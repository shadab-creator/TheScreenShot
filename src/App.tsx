import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  captureFullscreen,
  copyToClipboard,
  savePng,
  type CaptureResult,
} from "./lib/tauri";
import { PreviewModal } from "./components/PreviewModal";

export function App() {
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const onFullscreen = useCallback(async () => {
    setError("");
    setStatus("Capturing…");
    setBusy(true);
    try {
      // Hide main window briefly so it doesn't appear in its own shot.
      const win = getCurrentWindow();
      await win.hide();
      await new Promise((r) => setTimeout(r, 120));
      const r = await captureFullscreen();
      await win.show();
      await win.setFocus();
      setResult(r);
      setStatus("");
    } catch (e) {
      setError(String(e));
      setStatus("");
      try {
        await getCurrentWindow().show();
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

  useEffect(() => {
    const unlistenCap = listen<CaptureResult>("screenshot-captured", (evt) => {
      setResult(evt.payload);
      setStatus("");
      setError("");
      void getCurrentWindow().show();
      void getCurrentWindow().setFocus();
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

  const handleCopy = async () => {
    if (!result) return;
    try {
      await copyToClipboard(result);
      setStatus("Copied to clipboard");
      setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSave = async () => {
    if (!result) return;
    try {
      const path = await savePng(result);
      if (path) {
        setStatus(`Saved to ${path}`);
        setTimeout(() => setStatus(""), 2500);
      }
    } catch (e) {
      setError(String(e));
    }
  };

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
          disabled={busy}
        >
          Capture Full Screen
        </button>
        <button onClick={onRegion} disabled={busy}>
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

      {result && (
        <PreviewModal
          result={result}
          onClose={() => setResult(null)}
          onCopy={handleCopy}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}
