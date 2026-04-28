import { useCallback, useEffect, useRef, useState } from "react";
import {
  copyToClipboard,
  dataUrlFor,
  savePng,
  type CaptureResult,
} from "../lib/tauri";

type MarkTool = "rectangle" | "arrow" | "text";

const MARK_COLORS = [
  { label: "Red", value: "#ff4d4d" },
  { label: "Amber", value: "#ffb020" },
  { label: "Green", value: "#6bcb77" },
  { label: "Blue", value: "#4dabff" },
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#111111" },
];

interface Props {
  result: CaptureResult;
  onClose: () => void;
  onNotify: (message: string) => void;
  onError: (message: string) => void;
  /** Replace the working image (e.g. after resize). */
  onReplaceResult?: (r: CaptureResult) => void;
  /** Discard this capture and close (no save). */
  onDelete?: () => void;
}

function canvasPoint(
  e: React.PointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
) {
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  return {
    x: (e.clientX - r.left) * sx,
    y: (e.clientY - r.top) * sy,
  };
}

function normalizedRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  lw: number,
) {
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(14, lw * 4);
  const spread = Math.PI / 6.5;

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - head * Math.cos(angle - spread),
    y2 - head * Math.sin(angle - spread),
  );
  ctx.lineTo(
    x2 - head * Math.cos(angle + spread),
    y2 - head * Math.sin(angle + spread),
  );
  ctx.closePath();
  ctx.fill();
}

export function PreviewModal({
  result,
  onClose,
  onNotify,
  onError,
  onReplaceResult,
  onDelete,
}: Props) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const shapeSnapRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const shapeStart = useRef<{ x: number; y: number } | null>(null);

  const [color, setColor] = useState(MARK_COLORS[3].value);
  const [tool, setTool] = useState<MarkTool>("rectangle");
  const [textBuffer, setTextBuffer] = useState("Note");
  const [inkKey, setInkKey] = useState(0);
  const [dimW, setDimW] = useState(result.width);
  const [dimH, setDimH] = useState(result.height);

  const strokeWidth = Math.max(3, Math.round(result.width / 350));

  useEffect(() => {
    setDimW(result.width);
    setDimH(result.height);
  }, [result.width, result.height, result.base64]);

  useEffect(() => {
    const base = baseRef.current;
    const ink = inkRef.current;
    if (!base || !ink) return;

    base.width = result.width;
    base.height = result.height;
    ink.width = result.width;
    ink.height = result.height;

    const ctx = base.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, result.width, result.height);
    };
    img.src = dataUrlFor(result);

    const ictx = ink.getContext("2d");
    if (ictx) {
      ictx.clearRect(0, 0, ink.width, ink.height);
    }
  }, [result]);

  useEffect(() => {
    const ink = inkRef.current;
    if (!ink) return;
    const ictx = ink.getContext("2d");
    if (ictx) {
      ictx.clearRect(0, 0, ink.width, ink.height);
    }
  }, [inkKey, result.width, result.height]);

  const composite = useCallback((): CaptureResult => {
    const base = baseRef.current;
    const ink = inkRef.current;
    if (!base || !ink) return result;

    const out = document.createElement("canvas");
    out.width = result.width;
    out.height = result.height;
    const o = out.getContext("2d");
    if (!o) return result;
    o.drawImage(base, 0, 0);
    o.drawImage(ink, 0, 0);
    const dataUrl = out.toDataURL("image/png");
    const prefix = "data:image/png;base64,";
    const base64 = dataUrl.startsWith(prefix)
      ? dataUrl.slice(prefix.length)
      : dataUrl.split(",")[1] ?? "";
    return { base64, width: result.width, height: result.height };
  }, [result]);

  const clearMarks = () => setInkKey((k) => k + 1);

  const applyResize = () => {
    if (!onReplaceResult) return;
    const w = Math.max(32, Math.min(8192, Math.round(Number(dimW)) || result.width));
    const h = Math.max(32, Math.min(8192, Math.round(Number(dimH)) || result.height));
    if (w === result.width && h === result.height) return;
    const cap = composite();
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const cx = c.getContext("2d");
      if (!cx) return;
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = "high";
      cx.drawImage(img, 0, 0, w, h);
      const dataUrl = c.toDataURL("image/png");
      const prefix = "data:image/png;base64,";
      const base64 = dataUrl.startsWith(prefix)
        ? dataUrl.slice(prefix.length)
        : dataUrl.split(",")[1] ?? "";
      onReplaceResult({ base64, width: w, height: h });
      setInkKey((k) => k + 1);
      onNotify(`Resized to ${w}×${h}`);
    };
    img.onerror = () => onError("Could not resize image");
    img.src = dataUrlFor(cap);
  };

  const ensureShapeSnapshot = (w: number, h: number) => {
    let snap = shapeSnapRef.current;
    if (!snap) {
      snap = document.createElement("canvas");
      shapeSnapRef.current = snap;
    }
    snap.width = w;
    snap.height = h;
    return snap;
  };

  const redrawShapePreview = (
    ink: HTMLCanvasElement,
    endPoint: { x: number; y: number },
  ) => {
    const ctx = ink.getContext("2d");
    const snap = shapeSnapRef.current;
    const start = shapeStart.current;
    if (!ctx || !snap || !start) return;

    ctx.clearRect(0, 0, ink.width, ink.height);
    ctx.drawImage(snap, 0, 0);

    const r = normalizedRect(start, endPoint);
    if (r.w < 1 || r.h < 1) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";
    const inset = strokeWidth / 2;
    const rw = Math.max(r.w - strokeWidth, 0);
    const rh = Math.max(r.h - strokeWidth, 0);
    if (rw < 1 || rh < 1) return;
    ctx.strokeRect(r.x + inset, r.y + inset, rw, rh);
  };

  const redrawArrowPreview = (
    ink: HTMLCanvasElement,
    endPoint: { x: number; y: number },
  ) => {
    const ctx = ink.getContext("2d");
    const snap = shapeSnapRef.current;
    const start = shapeStart.current;
    if (!ctx || !snap || !start) return;

    ctx.clearRect(0, 0, ink.width, ink.height);
    ctx.drawImage(snap, 0, 0);

    const dx = endPoint.x - start.x;
    const dy = endPoint.y - start.y;
    if (dx * dx + dy * dy < 4) return;

    drawArrow(ctx, start.x, start.y, endPoint.x, endPoint.y, color, strokeWidth);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const c = inkRef.current;
    if (!c) return;

    if (tool === "text") {
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const p = canvasPoint(e, c);
      const raw = textBuffer;
      const lines =
        raw.trim().length > 0 ? raw.split("\n") : ["Text"];
      const fontPx = Math.max(15, Math.round(result.width / 50));
      const lineHeight = fontPx * 1.25;
      ctx.font = `600 ${fontPx}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = color;
      ctx.textBaseline = "top";
      lines.forEach((line, i) => {
        ctx.fillText(line, p.x, p.y + i * lineHeight);
      });
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = canvasPoint(e, c);

    const snap = ensureShapeSnapshot(c.width, c.height);
    snap.getContext("2d")?.drawImage(c, 0, 0);
    shapeStart.current = p;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || tool === "text") return;
    const c = inkRef.current;
    if (!c) return;
    const p = canvasPoint(e, c);
    if (tool === "rectangle") redrawShapePreview(c, p);
    else redrawArrowPreview(c, p);
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>, commitShape: boolean) => {
    const c = inkRef.current;
    if (!c) {
      drawing.current = false;
      shapeStart.current = null;
      return;
    }

    const wasDrawing = drawing.current;

    if (wasDrawing) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }

    if (wasDrawing && tool !== "text") {
      const ctx = c.getContext("2d");
      const snap = shapeSnapRef.current;
      if (commitShape && shapeStart.current && ctx && snap) {
        const p = canvasPoint(e, c);
        if (tool === "rectangle") redrawShapePreview(c, p);
        else redrawArrowPreview(c, p);
      } else if (!commitShape && ctx && snap) {
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(snap, 0, 0);
      }
    }

    drawing.current = false;
    shapeStart.current = null;
  };

  const handleCopy = async () => {
    try {
      await copyToClipboard(composite());
      onNotify("Copied to clipboard");
    } catch (err) {
      onError(String(err));
    }
  };

  const handleSave = async () => {
    try {
      const path = await savePng(composite());
      if (path) {
        onClose();
        onNotify(`Saved to ${path}`);
      }
    } catch (err) {
      onError(String(err));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--preview" onClick={(ev) => ev.stopPropagation()}>
        <header>
          <strong>Preview</strong>
          <span className="modal-meta">
            {result.width} × {result.height}px · annotate
          </span>
        </header>

        <div className="annotate-toolbar">
          <div className="annotate-tool-group" role="group" aria-label="Shape tool">
            {(
              [
                ["rectangle", "Rectangle"],
                ["arrow", "Arrow"],
                ["text", "Text"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`annotate-tool${tool === id ? " annotate-tool--active" : ""}`}
                onClick={() => setTool(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tool === "text" && (
            <label className="annotate-text-field">
              <span className="annotate-label">Label</span>
              <textarea
                value={textBuffer}
                onChange={(ev) => setTextBuffer(ev.target.value)}
                placeholder="Click image to place (multiple lines ok)"
                rows={3}
                maxLength={2000}
                spellCheck
              />
            </label>
          )}

          <span className="annotate-label">Color</span>
          <div className="annotate-swatches">
            {MARK_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`annotate-swatch${color === c.value ? " selected" : ""}`}
                style={{ background: c.value }}
                title={c.label}
                onClick={() => setColor(c.value)}
                aria-label={c.label}
              />
            ))}
          </div>
          <button type="button" className="annotate-clear" onClick={clearMarks}>
            Clear marks
          </button>
        </div>

        {onReplaceResult && (
          <div className="preview-resize-row">
            <span className="annotate-label">Canvas size</span>
            <input
              type="number"
              className="preview-resize-input"
              min={32}
              max={8192}
              value={dimW}
              onChange={(ev) => setDimW(Number(ev.target.value))}
              aria-label="Width in pixels"
            />
            <span className="preview-resize-times">×</span>
            <input
              type="number"
              className="preview-resize-input"
              min={32}
              max={8192}
              value={dimH}
              onChange={(ev) => setDimH(Number(ev.target.value))}
              aria-label="Height in pixels"
            />
            <button type="button" className="preview-resize-apply" onClick={applyResize}>
              Apply resize
            </button>
            <span className="preview-resize-hint">Scales image + marks</span>
          </div>
        )}

        <div className="preview preview--stack">
          <div className="preview-canvas-wrap">
            <canvas ref={baseRef} className="preview-canvas preview-canvas--base" />
            <canvas
              ref={inkRef}
              className="preview-canvas preview-canvas--ink"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => finishStroke(e, true)}
              onPointerCancel={(e) => finishStroke(e, false)}
              onPointerLeave={(e) => {
                if (drawing.current) finishStroke(e, true);
              }}
            />
          </div>
        </div>

        <footer>
          <button type="button" onClick={onClose}>
            Close
          </button>
          {onDelete && (
            <button type="button" className="btn-danger" onClick={onDelete}>
              Delete
            </button>
          )}
          <button type="button" onClick={handleCopy}>
            Copy
          </button>
          <button type="button" className="primary" onClick={handleSave}>
            Save…
          </button>
        </footer>
      </div>
    </div>
  );
}
