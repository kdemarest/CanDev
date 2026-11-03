# Research Browser

**Built 2026-11-03 as Lens** (`lens/`, repo kdemarest/lens): how it works and how to run it is in `lens/README.md`. This note keeps the reasoning.

A small Android app, built on the phone, for sites Claude can't read (TripAdvisor and others with bot blocking or logins). Written 2026-10-23 while researching Amazon guides, when TripAdvisor answered Claude's fetches with HTTP 403. Not part of Canopy or travel: a general workspace tool.

## Problem

Claude's web tools read public pages, but more and more sites block automated readers (TripAdvisor returns 403) or need a login. Ken needs that material often: reviews, guide names, phone numbers. Today the workaround is Ken copying text or saving pages as PDF by hand.

## Options considered

- **Ken shares pages by hand** (copy and paste, or Chrome → Share → Print → Save as PDF into Downloads). Works now, no setup, a few taps a page. The fallback, and fine for a handful of pages.
- **Claude drives Ken's Chrome** through Android's remote debugging (Wireless debugging in Developer options, `adb` paired in Termux, the DevTools protocol). No build, and real Chrome passes bot checks best. Rejected for regular use: the debugging connection controls the whole browser, every tab and logged-in session (email, bank), and adb is a shell on the phone; the pairing also lapses on restart.
- **A shim server or Ken's cookies** to fetch pages as Ken. Rejected: it's a way around the sites' bot blocking, against their terms, and puts Ken's accounts at risk.
- **A small WebView app with Claude in it** (this design). Ken browses as himself in a separate app, with its own sign-ins, and talks to Claude in a chat pane under the page. Claude can open pages, read them, fill in forms and click, in that app only, while Ken watches. The first version of this design had Ken alone at the wheel, saving pages for Claude; on 2026-11-03 Ken asked for Claude to drive it too, and to have the workspace's files and repos.

## Design (as built)

- **The app**: one Activity. Top: address bar, back and forward, **Save**, and **Chat** (cycles the chat pane hidden / 40% / 70%). Middle: the WebView Ken browses in; JavaScript and DOM storage on, cookies persist, so Ken signs into a site once. Bottom: the chat pane, a second WebView showing a page served by the bridge.
- **The bridge** (Termux, Node, no packages): serves the chat pane at 127.0.0.1:8077 and runs `claude` headless (`-p`, stream-json in and out) in `/sdcard/dev`, so Claude has the workspace as in a Termux session. Claude's permission prompts come to the bridge (`--permission-prompt-tool stdio`) and show as Allow/Deny cards; its multiple-choice questions show as question cards. The chat and Claude's session id are kept, so a bridge restart resumes the conversation.
- **Browser tools**: an MCP server (`bridge/mcp.js`) gives Claude `browser_open`, `_read`, `_elements` (numbered links, buttons, fields), `_click`, `_type`, `_select`, `_scroll`, `_back`, `_screenshot`, `_js`. A call goes mcp.js → bridge → chat pane (over SSE) → the app's `LensHost` interface → the browse WebView, and back. All the logic is in JavaScript; the Java only builds the screen and relays.
- **Rules for Claude** (in its system prompt): fill forms freely, but ask in the chat before buying, booking, sending, posting, deleting or changing account settings; never type passwords or payment details; if a page shows a CAPTCHA or bot check, ask Ken to solve it. `browser_js` asks for approval each time.
- **Save**: the Save button writes the page's text, URL, title and time to `/sdcard/Download/research/` (outside any repo, since pages may hold private or copyrighted text), one Markdown file per save.
- **Security**: the bridge listens on 127.0.0.1 only, checks the Host header, and needs a token on every API call. `runLens` makes the token (kept in `~/.local/share/lens/token`) and hands it to the app when it opens it; other apps can't read it.
- **Bot checks**: some sites flag WebViews (the `X-Requested-With` header names the app). Ken solves a challenge by hand when one appears. If a site refuses WebViews outright, fall back to sharing from Chrome.
- **Opening links**: a share target (Chrome's Share → Lens), a launcher icon, `runLens <url>`, and links in the chat open in the browse pane. tel:, mailto: and downloads go to the system.

## Building on the phone

No Gradle and no resources (the UI is built in code), so the build is: `aapt2 link` the manifest against `android.jar`; `javac` (Java, not Kotlin: no stdlib to bundle, quicker builds); `d8`; `aapt add` the dex; `zipalign`; `apksigner`; then `termux-open` the APK to install. `android.jar` is Google's SDK Platform 36 zip, fetched once and checked against the sha1 in Google's SDK repository manifest. Output stays in `~/.cache/lens-build`; the jar and signing key in `~/.local/share/lens`.

## Later

Auto-save of every page; the HTML alongside the text; an index of saves; starting the bridge from the app (Termux's RUN_COMMAND intent); a file chooser for upload fields; streaming Claude's text as it is written.
