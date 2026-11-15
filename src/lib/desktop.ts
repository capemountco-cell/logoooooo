/**
 * LOGOO for Mac (src-tauri) opens this web app in a native window and marks its user agent with
 * "LOGOODesktop/". In the Mac app the toolbar doubles as the title bar: its empty areas carry
 * data-tauri-drag-region (dragging moves the window), and the html element gets "desktop-app" so
 * headers that hold controls at the far left (the workspace) leave room for the traffic lights.
 */
export function isDesktopApp(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  return /\bLOGOODesktop\//.test(ua);
}

export function initDesktop() {
  if (typeof document !== "undefined" && isDesktopApp()) document.documentElement.classList.add("desktop-app");
}

/** Fired by the Mac app's File → Start Over menu item (src-tauri/src/lib.rs START_OVER_EVENT). */
export const START_OVER_EVENT = "logoo:start-over";
