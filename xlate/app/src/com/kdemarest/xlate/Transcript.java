package com.kdemarest.xlate;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.provider.MediaStore;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * The session's Markdown file, Documents/xlate/yy-mm-dd-hh-mm.md. Each utterance is appended as soon
 * as it is done, so a crash loses nothing already shown. MediaStore rather than a File: it is how an
 * app gets a shared folder without all-files access, and the files outlive an uninstall.
 */
final class Transcript {
    private final ContentResolver resolver;
    private final Uri uri;
    final String name;
    private final StringBuilder unwritten = new StringBuilder();

    Transcript(ContentResolver resolver, Date start) throws IOException {
        this.resolver = resolver;
        name = fileName(start);
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, "text/markdown");
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, "Documents/xlate");
        uri = resolver.insert(MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
        if (uri == null) throw new IOException("Could not create " + name);
        append(header(start));
    }

    /** A failed write is kept and goes out ahead of the next one. */
    synchronized void append(String text) throws IOException {
        unwritten.append(text);
        try (OutputStream out = resolver.openOutputStream(uri, "wa")) {
            if (out == null) throw new IOException("Could not open " + name);
            out.write(unwritten.toString().getBytes(StandardCharsets.UTF_8));
        }
        unwritten.setLength(0);
    }

    static String fileName(Date start) {
        return new SimpleDateFormat("yy-MM-dd-HH-mm", Locale.ROOT).format(start) + ".md";
    }

    static String header(Date start) {
        return "# Transcript " + new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT).format(start) + "\n\n";
    }

    static String format(Entry e) {
        String time = new SimpleDateFormat("HH:mm:ss", Locale.ROOT).format(e.time);
        String from = e.language.toUpperCase(Locale.ROOT), to = e.target().toUpperCase(Locale.ROOT);
        String quoted = e.translation != null ? e.translation : "_(not translated: " + e.problem + ")_";
        return "**" + time + " " + from + " → " + to + "**\n\n" + e.text + "\n\n> "
            + quoted.replace("\n", "\n> ") + "\n\n";
    }
}
