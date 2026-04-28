import { useEffect, useState } from "react";
import { copyToClipboard, dataUrlFor, type CaptureResult } from "../lib/tauri";
import {
  type RecentItem,
  recentToCaptureResult,
} from "../lib/recents";

interface Props {
  items: RecentItem[];
  onEdit: (result: CaptureResult) => void;
  onRemove: (id: string) => void;
  onNotify: (message: string) => void;
  onError: (message: string) => void;
}

export function RecentScreenshots({
  items,
  onEdit,
  onRemove,
  onNotify,
  onError,
}: Props) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const it of items) {
        try {
          const cap = await recentToCaptureResult(it);
          if (!cancelled) next[it.id] = dataUrlFor(cap);
        } catch {
          /* skip broken entry */
        }
      }
      if (!cancelled) setThumbs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  if (items.length === 0) {
    return (
      <section className="recents">
        <h2 className="recents-title">Recent screenshots</h2>
        <p className="recents-empty">Up to 10 captures will appear here.</p>
      </section>
    );
  }

  return (
    <section className="recents">
      <h2 className="recents-title">Recent screenshots</h2>
      <div className="recents-strip">
        {items.map((it) => (
          <div key={it.id} className="recents-card">
            <button
              type="button"
              className="recents-thumb-wrap"
              onClick={async () => {
                try {
                  const cap = await recentToCaptureResult(it);
                  onEdit(cap);
                } catch (e) {
                  onError(String(e));
                }
              }}
              title="Edit / annotate"
            >
              {thumbs[it.id] ? (
                <img
                  src={thumbs[it.id]}
                  alt=""
                  className="recents-thumb"
                />
              ) : (
                <div className="recents-thumb-placeholder">…</div>
              )}
            </button>
            <div className="recents-meta">
              {it.width}×{it.height}
            </div>
            <div className="recents-actions">
              <button
                type="button"
                className="recents-action"
                onClick={async () => {
                  try {
                    const cap = await recentToCaptureResult(it);
                    onEdit(cap);
                  } catch (e) {
                    onError(String(e));
                  }
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="recents-action"
                onClick={async () => {
                  try {
                    const cap = await recentToCaptureResult(it);
                    await copyToClipboard(cap);
                    onNotify("Copied to clipboard");
                  } catch (e) {
                    onError(String(e));
                  }
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="recents-action recents-action--danger"
                onClick={() => onRemove(it.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
