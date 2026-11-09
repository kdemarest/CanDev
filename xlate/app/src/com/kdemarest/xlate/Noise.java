package com.kdemarest.xlate;

import java.util.Locale;

/** Whisper invents text on near-silence, mostly the subtitle credits it was trained on. */
final class Noise {
    private static final String[] INVENTED = {
        "amara.org", "subtitulos", "subtítulos", "gracias por ver", "suscríbete", "suscribete",
        "thanks for watching", "thank you for watching", "like and subscribe",
    };
    // Real sentences measured up to 0.74, so this only catches what is almost surely not speech.
    private static final float NO_SPEECH = 0.9f;

    static boolean isNoise(String text, float noSpeech) {
        String t = text.trim().toLowerCase(Locale.ROOT);
        if (t.isEmpty() || noSpeech > NO_SPEECH) return true;
        if (t.matches("[\\[(*♪].*[\\])*♪]")) return true;  // [Música], (applause), ♪
        if (t.replaceAll("[\\p{P}\\s]", "").isEmpty()) return true;
        for (String s : INVENTED) if (t.contains(s)) return true;
        return false;
    }
    private Noise() {}
}
