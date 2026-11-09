package com.kdemarest.xlate;

import java.util.Arrays;

/**
 * Cuts the endless microphone stream into utterances at the speaker's pauses. Speech is whatever
 * stands clear of the noise floor: the quietest moment of the last few seconds. Even nonstop talk
 * dips to the room's level between syllables, so the floor follows the room in both directions,
 * during speech too, and a fan or a cafe stops counting as talking within seconds.
 */
final class Segmenter {
    interface Sink { void utterance(float[] pcm); }

    static final int RATE = 16000;
    static final int FRAME = 480;                      // 30 ms
    private static final int FRAMES_PER_SEC = RATE / FRAME;
    private static final int PRE_ROLL = 10;            // kept from before speech: soft word starts
    private static final int START_FRAMES = 3;         // loud frames in a row that begin speech
    private static final int END_FRAMES = 17;          // ~500 ms of quiet ends the utterance
    private static final int TAIL_FRAMES = 7;          // quiet kept after the last word
    private static final int MIN_VOICED = 10;          // under ~300 ms is a cough or a knock
    private static final int MAX_FRAMES = 8 * FRAMES_PER_SEC;   // nonstop talk still shows up soon
    private static final int CUT_SEARCH = 3 * FRAMES_PER_SEC;
    private static final int FLOOR_WINDOW = 3 * FRAMES_PER_SEC;
    private static final float DIGITAL_SILENCE = 0.00001f;      // a mic opening, not a quiet room
    private static final float MIN_THRESHOLD = 0.004f;
    private static final float OVER_FLOOR = 3f;

    private final Sink sink;
    private final float[][] preRoll = new float[PRE_ROLL][FRAME];
    private final float[] preRollEnergy = new float[PRE_ROLL];
    private int preRollCount, preRollNext;
    private final float[] samples = new float[(MAX_FRAMES + PRE_ROLL) * FRAME];
    private final float[] energy = new float[MAX_FRAMES + PRE_ROLL];
    private int frames, loud, quiet, voiced;
    private boolean speaking;
    private final float[] recent = new float[FLOOR_WINDOW];
    private int recentNext;
    private volatile float level;

    Segmenter(Sink sink) { this.sink = sink; }

    /** The last frame's loudness, 0 to 1, for the level meter. */
    float level() { return level; }

    boolean speaking() { return speaking; }

    /** @param frame exactly FRAME samples. */
    void feed(float[] frame) {
        float rms = rms(frame);
        level = Math.min(1f, rms * 8f);
        float threshold = Math.max(MIN_THRESHOLD, floor(rms) * OVER_FLOOR);
        if (speaking) continueSpeech(frame, rms, threshold);
        else listen(frame, rms, threshold);
    }

    /** The microphone is closing: hand over whatever was being said. */
    void flush() {
        if (speaking) emit(frames);
        speaking = false;
    }

    private void listen(float[] frame, float rms, float threshold) {
        System.arraycopy(frame, 0, preRoll[preRollNext], 0, FRAME);
        preRollEnergy[preRollNext] = rms;
        preRollNext = (preRollNext + 1) % PRE_ROLL;
        preRollCount = Math.min(PRE_ROLL, preRollCount + 1);

        loud = rms > threshold ? loud + 1 : 0;
        if (loud < START_FRAMES) return;
        speaking = true;
        frames = 0;
        for (int i = 0; i < preRollCount; i++) {
            int at = (preRollNext - preRollCount + i + PRE_ROLL) % PRE_ROLL;
            append(preRoll[at], preRollEnergy[at]);
        }
        voiced = loud;
        quiet = 0;
        loud = 0;
        preRollCount = 0;
    }

    private void continueSpeech(float[] frame, float rms, float threshold) {
        append(frame, rms);
        if (rms > threshold * 0.7f) {  // a lower bar to stay in speech than to enter it
            voiced++;
            quiet = 0;
        } else if (++quiet >= END_FRAMES) {
            emit(frames - quiet + TAIL_FRAMES);
            speaking = false;
            return;
        }
        if (frames >= MAX_FRAMES) forceCut();
    }

    /** Nobody paused for MAX_FRAMES: cut at the quietest moment lately, and keep going from there. */
    private void forceCut() {
        int cut = frames - 1;
        for (int i = frames - 1; i >= frames - CUT_SEARCH; i--) if (energy[i] < energy[cut]) cut = i;
        emit(cut + 1);
        int rest = frames - (cut + 1);
        System.arraycopy(samples, (cut + 1) * FRAME, samples, 0, rest * FRAME);
        System.arraycopy(energy, cut + 1, energy, 0, rest);
        frames = rest;
        voiced = MIN_VOICED;  // the rest of a sentence under way, not a cough to be judged afresh
        quiet = 0;
    }

    private float floor(float rms) {
        if (rms > DIGITAL_SILENCE) {
            recent[recentNext] = rms;
            recentNext = (recentNext + 1) % FLOOR_WINDOW;
        }
        float floor = Float.MAX_VALUE;
        for (float r : recent) if (r > 0 && r < floor) floor = r;
        return floor == Float.MAX_VALUE ? 0 : floor;
    }

    private void emit(int upTo) {
        if (voiced >= MIN_VOICED) sink.utterance(Arrays.copyOf(samples, upTo * FRAME));
    }

    private void append(float[] frame, float rms) {
        System.arraycopy(frame, 0, samples, frames * FRAME, FRAME);
        energy[frames++] = rms;
    }

    private static float rms(float[] frame) {
        double sum = 0;
        for (float s : frame) sum += s * s;
        return (float) Math.sqrt(sum / frame.length);
    }
}
