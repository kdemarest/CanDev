# Xlate

Android app: an always-on microphone for a conversation in English and Spanish. It detects which
language each sentence is in, writes it down, and shows the translation. It keeps a Markdown
transcript of the whole session.

```
mic → Segmenter → whisper.cpp (on the phone) → Claude Haiku → screen + transcript
```

- **The microphone stays open** until Stop, in a foreground service, with the screen off too. Only
  Android can close it: another app taking the mic shows in the status line and recovers by itself;
  if Android kills the app, a notification says so.
- **Speech to text** runs on the phone. Whisper detects the language of every sentence, and audio
  never leaves the device. Only the recognized text goes to Claude.
- **Translation** is `claude-haiku-5-5`, which also double-checks the language from the words.
- **Transcripts** are `Documents/xlate/yy-mm-dd-hh-mm.md`, one per session, named for its start and
  appended sentence by sentence. A sentence that couldn't be translated is kept, marked as such.

## Build and run

```
bash xlate/build.sh      # then My Files → Downloads → xlate.apk → Install
bash xlate/test/run.sh   # the Android-free logic on the JVM
```

First Start asks for an Anthropic API key (kept in the app's private storage), the microphone
permission and the battery exemption, then fetches the speech model (264 MB, once).
