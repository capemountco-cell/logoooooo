# LOGOO for Mac

LOGOO for Mac is a native macOS app (Tauri, the same setup as Camu) in `src-tauri/`. It opens the
hosted LOGOO app (https://logoooooo.lovable.app) in a native window, so:

- everything you change in Lovable reaches the Mac app at once, with no new download;
- the OpenAI, xAI and Brave keys stay on the server and never ship inside the app;
- the Mac app needs an internet connection (it says so, with Try again, when there is none).

What the Mac app adds over the browser: a real window with traffic lights and a Dock icon, the
toolbar as the title bar (drag it to move the window), exports saved straight to ~/Downloads
(never overwriting: "logo 2.svg"…), and links to other sites opening in your browser.

## Getting the .dmg

GitHub builds it on a Mac (`.github/workflows/desktop.yml`):

1. Open the repository's **Actions** tab → **Mac app**.
2. Open the latest run (every change to `src-tauri/` builds one; or press **Run workflow**).
3. Download **LOGOO-mac** under *Artifacts*, unzip it, open the .dmg and drag LOGOO to Applications.

For a release with a permanent download link, run the workflow with a version (e.g. `0.2.0`, the
same as `version` in `src-tauri/tauri.conf.json`). It creates the GitHub release, and
`https://github.com/capemountco-cell/logoooooo/releases/latest/download/LOGOO.dmg` always points
at the newest one.

## First launch (until the app is signed)

Without Apple signing the app is ad-hoc signed. The first time, macOS blocks it: right-click
LOGOO in Applications → **Open** → **Open** (or System Settings → Privacy & Security → **Open
Anyway**). After that it opens normally.

## Signing and notarization

With an Apple Developer account ($99/year) the workflow signs and notarizes automatically once
these repository secrets exist (Settings → Secrets and variables → Actions) — the same ones Camu
uses, so they can be copied over:

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | Your "Developer ID Application" certificate exported as .p12, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | The .p12 export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_PASSWORD` | An app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | Your 10-character team ID |

## Building on your own Mac

```sh
cd src-tauri
npx @tauri-apps/cli@2 dev      # run it
npx @tauri-apps/cli@2 build    # build LOGOO.app and the .dmg
```

Needs Rust (`rustup`) and Xcode's command line tools. The icon is `src-tauri/app-icon.png`;
regenerate the set with `npx @tauri-apps/cli@2 icon app-icon.png` (then delete the android/ios
folders and the Square*/StoreLogo files).
