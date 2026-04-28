use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

use crate::capture::{
    capture_focused_window_image, capture_for_tauri_monitor_bounds, capture_primary,
    capture_screen_region_physical, encode_png, MonitorBounds,
};

#[derive(Debug, Serialize, Deserialize)]
pub struct CaptureResult {
    /// PNG bytes, base64-encoded (no data-url prefix).
    pub base64: String,
    /// Physical pixel dimensions of the returned PNG.
    pub width: u32,
    pub height: u32,
}

fn to_result(img: image::RgbaImage) -> Result<CaptureResult, String> {
    let (width, height) = (img.width(), img.height());
    let png = encode_png(&img)?;
    Ok(CaptureResult {
        base64: B64.encode(png),
        width,
        height,
    })
}

/// `bounds` should be Tauri `currentMonitor()` position + size (physical px). When `None`, uses the primary display.
#[tauri::command]
pub async fn capture_fullscreen(bounds: Option<MonitorBounds>) -> Result<CaptureResult, String> {
    let frame = tauri::async_runtime::spawn_blocking(move || match bounds {
        Some(b) => capture_for_tauri_monitor_bounds(&b),
        None => capture_primary(),
    })
    .await
    .map_err(|e| format!("join error: {e}"))??;
    to_result(frame.image)
}

/// Region in **logical/CSS pixels** relative to the overlay window; `origin_*` is overlay
/// [`WebviewWindow::outer_position`] (physical px); `scale_factor` is overlay `scale_factor()`.
#[tauri::command]
pub async fn capture_region(
    origin_x: i32,
    origin_y: i32,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
) -> Result<CaptureResult, String> {
    let gx = origin_x + (x as f64 * scale_factor).round() as i32;
    let gy = origin_y + (y as f64 * scale_factor).round() as i32;
    let gw = (width as f64 * scale_factor).round().clamp(1.0, 1_000_000.0) as u32;
    let gh = (height as f64 * scale_factor).round().clamp(1.0, 1_000_000.0) as u32;

    let cropped = tauri::async_runtime::spawn_blocking(move || {
        capture_screen_region_physical(gx, gy, gw, gh)
    })
    .await
    .map_err(|e| format!("join error: {e}"))??;
    to_result(cropped)
}

#[tauri::command]
pub async fn capture_focused_window() -> Result<CaptureResult, String> {
    let img = tauri::async_runtime::spawn_blocking(capture_focused_window_image)
        .await
        .map_err(|e| format!("join error: {e}"))??;
    to_result(img)
}

/// Resize the overlay to span every monitor (call before showing region selection).
#[tauri::command]
pub fn prepare_region_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window missing".to_string())?;
    crate::layout_overlay_all_monitors(&overlay).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_png(base64_png: String, path: String) -> Result<(), String> {
    let bytes = B64
        .decode(base64_png.as_bytes())
        .map_err(|e| format!("base64 decode failed: {e}"))?;
    let p = PathBuf::from(path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
        }
    }
    fs::write(&p, &bytes).map_err(|e| format!("write failed: {e}"))?;
    Ok(())
}
