mod capture;
mod commands;

use tauri::{Emitter, LogicalPosition, LogicalSize, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use commands::{capture_fullscreen, capture_region, save_png};

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
            save_png,
        ])
        .setup(move |app| {
            app.global_shortcut().register(capture_shortcut)?;

            // Size the overlay window to cover the primary monitor (in
            // logical units). Avoids native-fullscreen Space switching on
            // macOS, which would be disruptive for a screenshot overlay.
            if let Some(overlay) = app.get_webview_window("overlay") {
                if let Ok(Some(monitor)) = overlay.primary_monitor() {
                    let sf = monitor.scale_factor();
                    let size = monitor.size();
                    let pos = monitor.position();
                    let w = size.width as f64 / sf;
                    let h = size.height as f64 / sf;
                    let x = pos.x as f64 / sf;
                    let y = pos.y as f64 / sf;
                    let _ = overlay.set_size(LogicalSize::new(w, h));
                    let _ = overlay.set_position(LogicalPosition::new(x, y));
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
