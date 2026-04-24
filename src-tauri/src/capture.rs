use image::{codecs::png::PngEncoder, ImageBuffer, ImageEncoder, Rgba, RgbaImage};
use xcap::Monitor;

pub struct CapturedFrame {
    pub image: RgbaImage,
    /// Logical-to-physical scale factor of the source monitor. Overlay
    /// coordinates come in as CSS (logical) pixels; multiply by this to
    /// get physical pixel coordinates inside `image`.
    pub scale_factor: f32,
}

fn pick_primary_monitor() -> Result<Monitor, String> {
    let monitors = Monitor::all().map_err(|e| format!("failed to enumerate monitors: {e}"))?;
    if monitors.is_empty() {
        return Err("no monitors detected".into());
    }
    let primary = monitors.iter().find(|m| m.is_primary()).cloned();
    Ok(primary.unwrap_or_else(|| monitors[0].clone()))
}

pub fn capture_primary() -> Result<CapturedFrame, String> {
    let monitor = pick_primary_monitor()?;
    let scale_factor = monitor.scale_factor();
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
