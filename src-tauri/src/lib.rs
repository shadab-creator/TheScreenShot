mod capture;
mod commands;

use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use commands::{
    capture_focused_window, capture_fullscreen, capture_region, prepare_region_overlay, save_png,
};

pub fn layout_overlay_all_monitors<R: tauri::Runtime>(
    overlay: &tauri::WebviewWindow<R>,
) -> tauri::Result<()> {
    let monitors = overlay.available_monitors()?;
    if monitors.is_empty() {
        return Ok(());
    }
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    for mon in &monitors {
        let p = mon.position();
        let s = mon.size();
        min_x = min_x.min(p.x);
        min_y = min_y.min(p.y);
        max_x = max_x.max(p.x + s.width as i32);
        max_y = max_y.max(p.y + s.height as i32);
    }
    let w = (max_x - min_x).max(1) as u32;
    let h = (max_y - min_y).max(1) as u32;
    overlay.set_size(PhysicalSize::new(w, h))?;
    overlay.set_position(PhysicalPosition::new(min_x, min_y))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Cmd+Shift+S on macOS, Ctrl+Shift+S elsewhere.
    #[cfg(target_os = "macos")]
    let capture_shortcut =
        Shortcut::new(Some(Modifiers::SHIFT | Modifiers::SUPER), Code::KeyS);
    #[cfg(not(target_os = "macos"))]
    let capture_shortcut =
        Shortcut::new(Some(Modifiers::SHIFT | Modifiers::CONTROL), Code::KeyS);

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &capture_shortcut
                        && matches!(event.state(), ShortcutState::Pressed)
                    {
                        if let Some(overlay) = app.get_webview_window("overlay") {
                            let _ = layout_overlay_all_monitors(&overlay);
                            let _ = overlay.show();
                            let _ = overlay.set_focus();
                        }
                        let _ = app.emit("show-overlay", ());
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            capture_fullscreen,
            capture_region,
            capture_focused_window,
            prepare_region_overlay,
            save_png,
        ])
        .setup(move |app| {
            app.global_shortcut().register(capture_shortcut)?;

            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = layout_overlay_all_monitors(&overlay);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
