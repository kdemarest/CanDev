package com.kdemarest.xlate;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Fetches the Whisper model once, into the app's private files. Too big for the repo or the APK.
 * small-q8_0: on an A36, base garbles Spanish and small-q5_1 is slower than speech (0.85x realtime);
 * q8_0 runs faster than q5_1 here despite the bigger file, because it maps onto the dotprod instructions.
 */
final class ModelStore {
    private static final String URL_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
    private static final String NAME = "ggml-small-q8_0.bin";
    private static final String SHA256 = "49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f";
    private static final long SIZE = 264464607L;

    interface Progress { void percent(int percent); }

    private final File file, part;

    ModelStore(File dir) {
        file = new File(dir, NAME);
        part = new File(dir, NAME + ".part");
    }

    boolean ready() { return file.length() == SIZE; }

    String path() { return file.getPath(); }

    /** Picks up where an interrupted download stopped. */
    void download(Progress progress) throws IOException {
        long have = part.length();
        HttpURLConnection c = (HttpURLConnection) new URL(URL_BASE + NAME).openConnection();
        try {
            c.setConnectTimeout(20000);
            c.setReadTimeout(30000);
            if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");
            int status = c.getResponseCode();
            if (status != 200 && status != 206) throw new IOException("Model download: HTTP " + status);
            boolean resumed = status == 206;
            if (!resumed) have = 0;
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(part, resumed)) {
                byte[] buf = new byte[1 << 16];
                int shown = -1;
                for (int n; (n = in.read(buf)) > 0; ) {
                    out.write(buf, 0, n);
                    have += n;
                    int percent = (int) (have * 100 / SIZE);
                    if (percent != shown) progress.percent(shown = percent);
                }
            }
        } finally {
            c.disconnect();
        }
        if (!SHA256.equals(sha256(part))) {
            part.delete();
            throw new IOException("Model download was corrupt; try again");
        }
        if (!part.renameTo(file)) throw new IOException("Could not save the model");
    }

    private static String sha256(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            MessageDigest d = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[1 << 16];
            for (int n; (n = in.read(buf)) > 0; ) d.update(buf, 0, n);
            StringBuilder hex = new StringBuilder();
            for (byte b : d.digest()) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }
}
