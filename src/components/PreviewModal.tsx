import { useEffect } from "react";
import { dataUrlFor, type CaptureResult } from "../lib/tauri";

interface Props {
  result: CaptureResult;
  onClose: () => void;
  onCopy: () => void;
  onSave: () => void;
}

export function PreviewModal({ result, onClose, onCopy, onSave }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>Preview</strong>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {result.width} × {result.height}px
          </span>
        </header>
        <div className="preview">
          <img src={dataUrlFor(result)} alt="screenshot preview" />
        </div>
        <footer>
          <button onClick={onClose}>Close</button>
          <button onClick={onCopy}>Copy</button>
          <button className="primary" onClick={onSave}>
            Save…
          </button>
        </footer>
      </div>
    </div>
  );
}
