import { invoke } from "@tauri-apps/api/core";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";

export interface CaptureResult {
  base64: string;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const captureFullscreen = () =>
  invoke<CaptureResult>("capture_fullscreen");

export const captureRegion = (r: Rect) =>
  invoke<CaptureResult>("capture_region", r);

export const dataUrlFor = (r: CaptureResult) =>
  `data:image/png;base64,${r.base64}`;

/**
 * Copy a base64 PNG to the OS clipboard as an image. The clipboard plugin's
 * `writeImage` accepts the raw PNG bytes (not a decoded RGBA buffer) on v2,
 * so we just decode the base64 and hand them over.
 */
export async function copyToClipboard(result: CaptureResult): Promise<void> {
  const bytes = base64ToBytes(result.base64);
  await writeImage(bytes);
}

export async function savePng(result: CaptureResult): Promise<string | null> {
  const defaultName = `screenshot-${timestamp()}.png`;
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "PNG Image", extensions: ["png"] }],
  });
  if (!path) return null;
  await invoke("save_png", { base64Png: result.base64, path });
  return path;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
