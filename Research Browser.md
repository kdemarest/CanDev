# Research Browser

A design for a small Android app, built on the phone, that lets Ken browse sites Claude can't read (TripAdvisor and others with bot blocking or logins) and hand the pages to Claude. Not built yet; written 2026-10-23 while researching Amazon guides, when TripAdvisor answered Claude's fetches with HTTP 403. Not part of Canopy or travel: a general workspace tool.

## Problem

Claude's web tools read public pages, but more and more sites block automated readers (TripAdvisor returns 403) or need a login. Ken needs that material often: reviews, guide names, phone numbers. Today the workaround is Ken copying text or saving pages as PDF by hand.

## Options considered

- **Ken shares pages by hand** (copy and paste, or Chrome → Share → Print → Save as PDF into Downloads). Works now, no setup, a few taps a page. The fallback, and fine for a handful of pages.
- **Claude drives Ken's Chrome** through Android's remote debugging (Wireless debugging in Developer options, `adb` paired in Termux, the DevTools protocol). No build, and real Chrome passes bot checks best. Rejected for regular use: the debugging connection controls the whole browser, every tab and logged-in session (email, bank), and adb is a shell on the phone; the pairing also lapses on restart.
- **A shim server or Ken's cookies** to fetch pages as Ken. Rejected: it's a way around the sites' bot blocking, against their terms, and puts Ken's accounts at risk.
- **A small WebView app, Ken at the wheel** (this design). Ken browses as himself in a separate app; Claude sees only the pages Ken saves. Nothing automated crawls.

## Design

- **The app**: one Activity holding a WebView, with an address bar, back and forward, and a **Save** button. JavaScript and DOM storage on; cookies persist, so Ken signs into a site once. Its sessions are its own, separate from Chrome.
- **Save**: writes the page for Claude to a folder in shared storage, e.g. `/sdcard/Download/research/` (exact place to decide; outside any repo, since pages may hold private or copyrighted text). One file per save, named by time and title, holding the URL, the title, the time and the page's readable text (`document.body.innerText`, via `evaluateJavascript`). Optionally the HTML too, for pages whose text loses structure (tables, phone links).
- **Auto-save** (a setting, off by default): save every page Ken finishes loading, for long research sessions.
- **Handing over**: Ken says "read it"; Claude reads the newest files in the folder. A small index file (last saves, newest first) saves Claude listing the folder.
- **Bot checks**: some sites flag WebViews (the `X-Requested-With` header names the app). Ken solves a challenge by hand when one appears; it usually holds for the session. If a site refuses WebViews outright, fall back to sharing from Chrome.
- **Opening links**: a share target, so Chrome's Share → Research Browser opens the same page in the app; and a launcher icon.
- **Privacy**: Claude sees only saved pages. The save folder is never inside a repo. Nothing leaves the phone except what the sites themselves serve.

## Building on the phone

Termux has the whole toolchain for aarch64: `kotlin` (kotlinc 2.x), `openjdk-17` or 21, `aapt2`, `d8`, `apksigner`, and `gradle` if wanted. A one-Activity app needs no Gradle:

1. `aapt2 compile` the resources and `aapt2 link` them against `android.jar` with the manifest, producing the base APK and `R.java`;
2. `kotlinc` the Kotlin (and `R.java` via `javac`) against `android.jar`;
3. `d8` the classes to `classes.dex` and add it to the APK; zipalign;
4. `apksigner` with a debug key kept outside the repo (and recreated by `setup.sh` if missing);
5. install with `termux-open app.apk` (Termux needs "install unknown apps" once).

Open questions for the build: where `android.jar` comes from (the `aapt` package may ship one; else a pinned platform jar), and keeping build output in `~` (the sdcard is noexec and FUSE). A `build.sh` in the app's folder runs it all, in line with the plugins.

## Where it lives

Its own repo under `/sdcard/dev` (name to decide, e.g. `lens`), git dir in `~/git-repos/` like the others, cloned by `setup.sh`, with the toolchain packages added to `setup.sh`'s `pkg install` line. Ken creates the GitHub repo.

## First version

Address bar, back, Save to the folder with text and URL, share target. Then: auto-save, HTML alongside the text, and the index file.
