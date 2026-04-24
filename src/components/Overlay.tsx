import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { captureRegion, type CaptureResult } from "../lib/tauri";

type Point = { x: number; y: number };

/**
 * Fullscreen transparent overlay for click-and-drag region selection.
 *
 * Performance: the dragged rectangle is written to a ref + CSS variables on
 * every mousemove and committed to React state only on mouseup, so drag
 * tracking runs at display refresh without re-rendering the tree.
 */
export function Overlay() {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<Point | null>(null);
  const currentRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    // Grab focus so Esc works without a click first.
    rootRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cancel = async () => {
    try {
      await getCurrentWindow().hide();
    } catch {
      /* ignore */
    }
    resetBox();
  };

  const resetBox = () => {
    anchorRef.current = null;
    currentRef.current = null;
    if (boxRef.current) {
      boxRef.current.style.display = "none";
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (busy || e.button !== 0) return;
    anchorRef.current = { x: e.clientX, y: e.clientY };
    currentRef.current = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
    if (boxRef.current) {
      boxRef.current.style.display = "block";
      boxRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      boxRef.current.style.width = `0px`;
      boxRef.current.style.height = `0px`;
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const x = Math.min(anchor.x, e.clientX);
    const y = Math.min(anchor.y, e.clientY);
    const w = Math.abs(e.clientX - anchor.x);
    const h = Math.abs(e.clientY - anchor.y);
    currentRef.current = { x, y, w, h };

    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const cur = currentRef.current;
      const el = boxRef.current;
      if (!cur || !el) return;
      el.style.transform = `translate(${cur.x}px, ${cur.y}px)`;
      el.style.width = `${cur.w}px`;
      el.style.height = `${cur.h}px`;
    });
  };

  const onMouseUp = async () => {
    const rect = currentRef.current;
    anchorRef.current = null;
    if (!rect || rect.w < 3 || rect.h < 3) {
      resetBox();
      return;
    }
    setBusy(true);
    try {
      // Hide the overlay window BEFORE capturing so the dark scrim isn't
      // in the screenshot. Small delay to ensure the hide is painted.
      const win = getCurrentWindow();
      await win.hide();
      await new Promise((r) => setTimeout(r, 80));

      const result: CaptureResult = await captureRegion({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.w),
        height: Math.round(rect.h),
      });
      await emit("screenshot-captured", result);
    } catch (err) {
      console.error("capture_region failed:", err);
      await emit("screenshot-error", String(err));
    } finally {
      resetBox();
      setBusy(false);
    }
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.35)",
        cursor: "crosshair",
        outline: "none",
      }}
    >
      <div
        ref={boxRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          display: "none",
          border: "1.5px solid #4dabff",
          background: "rgba(77, 171, 255, 0.12)",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0) inset",
          pointerEvents: "none",
          willChange: "transform, width, height",
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "6px 12px",
          borderRadius: 8,
          background: "rgba(20, 20, 22, 0.75)",
          color: "#fff",
          fontSize: 12,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          pointerEvents: "none",
          letterSpacing: 0.2,
        }}
      >
        Drag to select a region &nbsp;·&nbsp; Esc to cancel
      </div>
    </div>
  );
}
