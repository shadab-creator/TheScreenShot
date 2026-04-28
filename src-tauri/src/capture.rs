use image::{codecs::png::PngEncoder, ImageBuffer, ImageEncoder, Rgba, RgbaImage};
use serde::Deserialize;
use xcap::{Monitor, XCapError};

/// Physical bounds of a monitor as reported by the windowing system (e.g. Tauri `currentMonitor`).
#[derive(Debug, Deserialize)]
pub struct MonitorBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub struct CapturedFrame {
    pub image: RgbaImage,
    /// Logical-to-physical scale factor of the source monitor. Overlay
    /// coordinates come in as CSS (logical) pixels; multiply by this to
    /// get physical pixel coordinates inside `image`.
    pub scale_factor: f32,
}

fn xcap_err(e: XCapError) -> String {
    format!("{e}")
}

fn pick_primary_monitor() -> Result<Monitor, String> {
    let monitors = Monitor::all().map_err(|e| format!("failed to enumerate monitors: {e}"))?;
    if monitors.is_empty() {
        return Err("no monitors detected".into());
    }
    for m in &monitors {
        if m.is_primary().map_err(xcap_err)? {
            return Ok(m.clone());
        }
    }
    Ok(monitors[0].clone())
}

fn capture_on_monitor(monitor: &Monitor) -> Result<CapturedFrame, String> {
    let scale_factor = monitor.scale_factor().map_err(xcap_err)?;
    let raw = monitor
        .capture_image()
        .map_err(|e| format!("capture_image failed: {e}"))?;

    // `xcap::Monitor::capture_image` already yields an `image::RgbaImage`,
    // but we re-wrap to guarantee the buffer is contiguous RGBA8.
    let (w, h) = (raw.width(), raw.height());
    let image: RgbaImage = ImageBuffer::<Rgba<u8>, _>::from_raw(w, h, raw.into_raw())
        .ok_or_else(|| "unexpected buffer size from xcap".to_string())?;

    Ok(CapturedFrame {
        image,
        scale_factor,
    })
}

/// Capture the display that contains `(px, py)` in global screen coordinates
/// (physical pixels, same space as Tauri `outer_position`).
pub fn capture_at_point(px: i32, py: i32) -> Result<CapturedFrame, String> {
    let monitor = Monitor::from_point(px, py).map_err(xcap_err)?;
    capture_on_monitor(&monitor)
}

fn rect_intersection_area(
    ax: i64,
    ay: i64,
    aw: i64,
    ah: i64,
    bx: i64,
    by: i64,
    bw: i64,
    bh: i64,
) -> i64 {
    let ix1 = ax.max(bx);
    let iy1 = ay.max(by);
    let ix2 = (ax + aw).min(bx + bw);
    let iy2 = (ay + ah).min(by + bh);
    if ix2 > ix1 && iy2 > iy1 {
        (ix2 - ix1) * (iy2 - iy1)
    } else {
        0
    }
}

/// Pick the xcap monitor that matches Tauri’s idea of the current display (overlap / center tests),
/// avoiding macOS coordinate mismatches between window APIs and `CGGetDisplaysWithPoint`.
pub fn capture_for_tauri_monitor_bounds(bounds: &MonitorBounds) -> Result<CapturedFrame, String> {
    let monitors: Vec<Monitor> =
        Monitor::all().map_err(|e| format!("failed to enumerate monitors: {e}"))?;
    if monitors.is_empty() {
        return Err("no monitors detected".into());
    }

    let bx = bounds.x as i64;
    let by = bounds.y as i64;
    let bw = bounds.width as i64;
    let bh = bounds.height as i64;
    let hint_cx = bx + bw / 2;
    let hint_cy = by + bh / 2;

    let mut best: Option<(Monitor, i64)> = None;
    for m in &monitors {
        let mx = m.x().map_err(xcap_err)? as i64;
        let my = m.y().map_err(xcap_err)? as i64;
        let mw = m.width().map_err(xcap_err)? as i64;
        let mh = m.height().map_err(xcap_err)? as i64;
        let area = rect_intersection_area(bx, by, bw, bh, mx, my, mw, mh);
        if area > 0 && best.as_ref().map_or(true, |(_, a)| area > *a) {
            best = Some((m.clone(), area));
        }
    }
    if let Some((m, _)) = best {
        return capture_on_monitor(&m);
    }

    for m in &monitors {
        let mx = m.x().map_err(xcap_err)? as i64;
        let my = m.y().map_err(xcap_err)? as i64;
        let mw = m.width().map_err(xcap_err)? as i64;
        let mh = m.height().map_err(xcap_err)? as i64;
        if hint_cx >= mx && hint_cx < mx + mw && hint_cy >= my && hint_cy < my + mh {
            return capture_on_monitor(m);
        }
    }

    capture_at_point(hint_cx as i32, hint_cy as i32).or_else(|_| capture_primary())
}

pub fn capture_primary() -> Result<CapturedFrame, String> {
    let monitor = pick_primary_monitor()?;
    capture_on_monitor(&monitor)
}

/// Crop an image using logical (CSS pixel) coordinates, applying the
/// source monitor's scale factor. Clamps to image bounds so an overshoot
/// at the edge of the screen does not error.
pub fn crop_logical(
    frame: &CapturedFrame,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<RgbaImage, String> {
    if width == 0 || height == 0 {
        return Err("region has zero size".into());
    }
    let sf = frame.scale_factor.max(1.0);
    let img_w = frame.image.width() as i32;
    let img_h = frame.image.height() as i32;

    let px = ((x as f32) * sf).round() as i32;
    let py = ((y as f32) * sf).round() as i32;
    let pw = ((width as f32) * sf).round() as i32;
    let ph = ((height as f32) * sf).round() as i32;

    let x0 = px.clamp(0, img_w);
    let y0 = py.clamp(0, img_h);
    let x1 = (px + pw).clamp(0, img_w);
    let y1 = (py + ph).clamp(0, img_h);

    let cw = (x1 - x0).max(0) as u32;
    let ch = (y1 - y0).max(0) as u32;
    if cw == 0 || ch == 0 {
        return Err("region is outside monitor bounds".into());
    }

    let view = image::imageops::crop_imm(&frame.image, x0 as u32, y0 as u32, cw, ch).to_image();
    Ok(view)
}

pub fn encode_png(img: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut buf = Vec::with_capacity((img.width() * img.height() * 4) as usize);
    PngEncoder::new(&mut buf)
        .write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| format!("png encode failed: {e}"))?;
    Ok(buf)
}
