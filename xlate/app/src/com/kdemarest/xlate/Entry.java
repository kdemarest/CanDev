package com.kdemarest.xlate;

import java.util.Date;

/** One utterance. Filled in as it moves through the pipeline; read on the main thread once done. */
final class Entry {
    final Date time;
    String language;
    final String text;
    volatile String translation;
    volatile String problem;

    Entry(Date time, String language, String text) {
        this.time = time;
        this.language = language;
        this.text = text;
    }

    /** "en" is translated to "es" and back. */
    String target() { return "es".equals(language) ? "en" : "es"; }
}
