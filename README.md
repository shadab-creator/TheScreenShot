# TheScreenShot

A minimal, cross-platform desktop screenshot app built with **Tauri v2** (Rust) and **React + TypeScript** (Vite).

## Features

- **Capture full screen** — one-click primary-monitor snapshot.
- **Capture region** — click-and-drag a selection on a dim overlay.
- **Global shortcut** — `Cmd/Ctrl + Shift + S` opens the region overlay from anywhere.
- **Preview modal** — see the shot, then **Copy** to clipboard or **Save** as PNG.
- **DPI / Retina aware** — logical overlay coordinates are scaled to physical pixels.
- **Basic multi-monitor support** — captures the primary monitor.
- **Esc cancels** region selection.

## Prerequisites

- **Rust** (stable) — install via [rustup](https://rustup.rs).
- **bun** — install via [bun.sh](https://bun.sh).
- Platform toolchain:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
  - **Windows**: Microsoft Edge WebView2 Runtime (preinstalled on Win11) + Visual Studio Build Tools with the "Desktop development with C++" workload.
  - **Linux**: `webkit2gtk-4.1`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`, and `patchelf`.

### Bundle icons

Tauri's bundler expects icons at `src-tauri/icons/*`. They are not included in this repo. For `bun tauri dev` you can usually skip this; for `bun tauri build`, generate them once from any square PNG:

```bash
bun tauri icon path/to/source-icon.png
```

## Install & Run

```bash
bun install
bun tauri dev
```

Production build:

```bash
bun tauri build
```

## Usage

1. Launch the app.
2. Click **Capture Full Screen** or **Capture Region**, or press `Cmd/Ctrl + Shift + S` anywhere.
3. For region capture: click-and-drag on the darkened overlay (`Esc` to cancel).
4. In the preview, choose **Copy** (image goes to OS clipboard) or **Save…** (file picker → PNG).

## macOS permission note

On first capture, macOS will prompt for **Screen Recording** permission. Grant it in **System Settings → Privacy & Security → Screen Recording**, then restart the app. This is required by the OS — there is no way to bypass it programmatically.

## Project Structure

```
.
├── index.html                 # Main window entry
├── overlay.html               # Overlay window entry (transparent, fullscreen)
├── vite.config.ts             # Multi-entry Vite config
├── package.json
├── tsconfig.json
├── src/
│   ├── main.tsx               # Main-window React root
│   ├── overlay.tsx            # Overlay-window React root
│   ├── App.tsx                # Main UI (buttons, preview)
│   ├── styles.css
│   ├── lib/
│   │   └── tauri.ts           # Frontend wrappers for Rust commands
│   └── components/
│       ├── Overlay.tsx        # Click-and-drag selection surface
│       └── PreviewModal.tsx   # Preview + Copy/Save
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json        # Windows, plugins, bundle config
    ├── capabilities/
    │   └── default.json       # Permissions for IPC/clipboard/fs/dialog
    ├── build.rs
    └── src/
        ├── main.rs            # Entrypoint
        ├── lib.rs             # Plugins, command registration, shortcut
        ├── capture.rs         # xcap-based monitor capture + crop + PNG
        └── commands.rs        # #[tauri::command] handlers
```

## How it works

### Rust commands (`src-tauri/src/commands.rs`)

- `capture_fullscreen() -> CaptureResult` — enumerates monitors via [`xcap`](https://crates.io/crates/xcap), picks the primary, returns PNG bytes + dimensions (PNG bytes are base64-encoded in the JSON reply).
- `capture_region(x, y, width, height) -> CaptureResult` — captures the primary monitor, multiplies the logical rect by the monitor's scale factor, crops, encodes PNG.
- `save_png(base64Png, path)` — decodes base64 and writes to disk.

Capturing runs on a blocking thread via `tauri::async_runtime::spawn_blocking` so it doesn't stall the UI thread.

### Frontend ↔ Rust (`src/lib/tauri.ts`)

```ts
import { invoke } from "@tauri-apps/api/core";

const result = await invoke<CaptureResult>("capture_region", {
  x: 100,
  y: 120,
  width: 640,
  height: 360,
});
```

### Region overlay

The overlay is a **separate transparent fullscreen Tauri window** (`label: "overlay"`) that renders `src/components/Overlay.tsx`. Drag tracking uses a `useRef` + `requestAnimationFrame` so the selection rect updates every frame without re-rendering React. On `mouseup` the overlay hides itself, calls `capture_region`, and emits `screenshot-captured` — the main window listens and shows the preview modal.

### Global shortcut

Registered in `src-tauri/src/lib.rs` via `tauri-plugin-global-shortcut` with a platform-specific modifier:

```rust
#[cfg(target_os = "macos")]
let shortcut = Shortcut::new(Some(Modifiers::SHIFT | Modifiers::SUPER), Code::KeyS);
#[cfg(not(target_os = "macos"))]
let shortcut = Shortcut::new(Some(Modifiers::SHIFT | Modifiers::CONTROL), Code::KeyS);
```

That yields **Cmd+Shift+S on macOS** and **Ctrl+Shift+S on Windows/Linux**.

## Limitations / Future Work

- Only the primary monitor is captured. `xcap::Monitor::from_point` could map the cursor's physical location to any monitor for true multi-display region capture.
- Overlay covers only the primary display. A full multi-monitor overlay would spawn one overlay window per `xcap::Monitor`.
- No image editing / annotation post-capture (out of scope).
