//! LOGOO for Mac. A native window (dark, overlay title bar, real traffic lights) that opens the
//! LOGOO app from its hosted address, so the AI keys stay on the server and every web update
//! reaches the Mac app at once. The bundled start page (desktop/index.html) only checks the
//! connection and then hands over; offline it says so and offers Retry.
//!
//! - Downloads (SVG, .ai, PNG) are saved to ~/Downloads, never navigated to.
//! - Links to other sites open in the default browser; the window only shows LOGOO.

use std::path::{Path, PathBuf};

use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::window::Color;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// The hosted LOGOO app (the Lovable deployment).
pub const APP_HOST: &str = "logoooooo.lovable.app";

/// Appended to the user agent so the web app can tell it runs inside the Mac app
/// (src/lib/desktop.ts) and leave room for the traffic lights.
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 LOGOODesktop/0.1";

/// Whether the window may show this address: the start page, LOGOO itself, or in-page data.
fn allowed(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" | "blob" | "data" | "about" => true,
        "http" if cfg!(debug_assertions) => url.host_str() == Some("localhost"),
        "https" => url.host_str() == Some(APP_HOST) || url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

/// Opens an outside link in the default browser.
fn open_externally(url: &tauri::Url) {
    if !matches!(url.scheme(), "https" | "http" | "mailto") {
        return;
    }
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url.as_str()).spawn();
}

/// A free path in `dir` for `name`: "logo.svg", then "logo 2.svg", "logo 3.svg"…
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("LOGOO export");
    let ext = p.extension().and_then(|s| s.to_str());
    for n in 2..1000 {
        let candidate = match ext {
            Some(e) => dir.join(format!("{stem} {n}.{e}")),
            None => dir.join(format!("{stem} {n}")),
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    first
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let downloads = app.path().download_dir().ok();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("LOGOO")
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 600.0)
                .center()
                .resizable(true)
                .theme(Some(tauri::Theme::Dark))
                // The window colour (#141416), so there is no white flash before the page paints.
                .background_color(Color(20, 20, 22, 255))
                .user_agent(USER_AGENT)
                // target="_blank" links (reference sources) open in the default browser.
                .on_new_window(|url, _features| {
                    open_externally(&url);
                    NewWindowResponse::Deny
                })
                .on_navigation(|url| {
                    if allowed(url) {
                        return true;
                    }
                    open_externally(url);
                    false
                })
                .on_download(move |_webview, event| {
                    if let DownloadEvent::Requested { destination, .. } = event {
                        if let Some(dir) = &downloads {
                            let name = destination
                                .file_name()
                                .and_then(|n| n.to_str())
                                .filter(|n| !n.is_empty())
                                .unwrap_or("LOGOO export")
                                .to_string();
                            *destination = unique_path(dir, &name);
                        }
                    }
                    true
                });
            #[cfg(target_os = "macos")]
            let builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                // In LOGOO's 40px title row, left of the centred wordmark.
                .traffic_light_position(tauri::Position::Logical(tauri::LogicalPosition::new(18.0, 14.0)));
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LOGOO");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_logoo_and_local_pages_stay_in_the_window() {
        let ok = |s: &str| allowed(&tauri::Url::parse(s).unwrap());
        assert!(ok("https://logoooooo.lovable.app/"));
        assert!(ok("https://logoooooo.lovable.app/api/brief"));
        assert!(ok("tauri://localhost/index.html"));
        assert!(ok("blob:https://logoooooo.lovable.app/1234"));
        assert!(!ok("https://example.com/"));
        assert!(!ok("https://logoooooo.lovable.app.evil.com/"));
        assert!(!ok("file:///etc/passwd"));
    }

    #[test]
    fn downloads_never_overwrite() {
        let dir = std::env::temp_dir().join(format!("logoo-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_path(&dir, "ember.svg"), dir.join("ember.svg"));
        std::fs::write(dir.join("ember.svg"), "x").unwrap();
        assert_eq!(unique_path(&dir, "ember.svg"), dir.join("ember 2.svg"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
