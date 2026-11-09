package com.kdemarest.xlate;

/** whisper.cpp, through native/xlate_jni.c. Not thread-safe: the service uses it from one thread. */
final class Whisper {
    static { System.loadLibrary("xlate"); }

    private static native long init(String modelPath);
    private static native void free(long handle);
    private static native String[] transcribe(long handle, float[] pcm, int threads);

    /**
     * One fewer than the phone's four fast cores. ggml's threads spin at a barrier, so when all four
     * are taken, anything else needing a core stalls the lot: 3 ran 1.5x faster than 4 on an A36.
     */
    private static final int THREADS = 3;
    private long handle;

    Whisper(String modelPath) {
        handle = init(modelPath);
        if (handle == 0) throw new IllegalStateException("Could not load " + modelPath);
    }

    static final class Result {
        final String language, text;
        final float noSpeech;
        Result(String language, String text, float noSpeech) {
            this.language = language;
            this.text = text;
            this.noSpeech = noSpeech;
        }
    }

    /** @param pcm mono 16 kHz samples, -1 to 1. @return null if whisper failed. */
    Result transcribe(float[] pcm) {
        String[] r = transcribe(handle, pcm, THREADS);
        return r == null ? null : new Result(r[0], r[1].trim(), Float.parseFloat(r[2]));
    }

    void close() {
        free(handle);
        handle = 0;
    }
}
