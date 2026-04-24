use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::capture::{capture_primary, crop_logical, encode_png};

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

#[tauri::command]
pub async fn capture_fullscreen() -> Result<CaptureResult, String> {
    let frame = tauri::async_runtime::spawn_blocking(capture_primary)
        .await
        .map_err(|e| format!("join error: {e}"))??;
    to_result(frame.image)
}

#[tauri::command]
pub async fn capture_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<CaptureResult, String> {
    let cropped = tauri::async_runtime::spawn_blocking(move || -> Result<image::RgbaImage, String> {
        let frame = capture_primary()?;
        crop_logical(&frame, x, y, width, height)
    })
    .await
    .map_err(|e| format!("join error: {e}"))??;
    to_result(cropped)
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
