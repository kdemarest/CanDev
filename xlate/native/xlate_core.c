// One utterance in, language and text out. Shared by the app (xlate_jni.c) and test/bench.c, so
// the benchmark measures exactly what the app runs.
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "xlate_core.h"

// whisper's encoder costs the same for 2 s of audio as for 30 s unless it is told the real length.
// 50 context positions per second, plus margin so the end of the clip isn't clipped.
static int audio_ctx_for(int samples) {
    int ctx = (int)ceilf(samples / 16000.0f * 50.0f) + 64;
    return ctx > 1500 ? 0 : ctx;  // 0: the full window
}

static int run(struct whisper_context *ctx, struct whisper_full_params *p, const float *pcm, int n) {
    return whisper_full(ctx, *p, pcm, n);
}

int xlate_transcribe(struct whisper_context *ctx, const float *pcm, int n, int threads, struct xlate_result *out) {
    struct whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    p.n_threads = threads;
    p.no_context = true;
    p.no_timestamps = true;
    p.single_segment = true;
    p.print_progress = false;
    p.print_realtime = false;
    p.print_timestamps = false;
    p.suppress_nst = true;
    p.audio_ctx = audio_ctx_for(n);
    p.language = "auto";  // detection runs inside whisper_full, on the shortened window

    int rc = run(ctx, &p, pcm, n);
    const int en = whisper_lang_id("en"), es = whisper_lang_id("es");
    int lang = rc == 0 ? whisper_full_lang_id(ctx) : -1;

    // Detection picks from 99 languages, and Spanish can come back as Portuguese or Galician.
    // Only two are possible here: take the likelier and transcribe again in it.
    out->retried = 0;
    if (rc == 0 && lang != en && lang != es) {
        float *probs = calloc(whisper_lang_max_id() + 1, sizeof(float));
        if (probs && whisper_lang_auto_detect(ctx, 0, threads, probs) >= 0) {
            lang = probs[es] > probs[en] ? es : en;
        } else {
            lang = en;
        }
        free(probs);
        p.language = whisper_lang_str(lang);
        out->retried = 1;
        rc = run(ctx, &p, pcm, n);
    }
    if (rc != 0) return rc;

    size_t size = 1, used = 0;
    char *text = calloc(size, 1);
    float noSpeech = 0;
    int segments = whisper_full_n_segments(ctx);
    for (int i = 0; i < segments && text; i++) {
        const char *s = whisper_full_get_segment_text(ctx, i);
        size_t len = strlen(s);
        char *grown = realloc(text, size + len);
        if (!grown) { free(text); return -1; }
        text = grown;
        memcpy(text + used, s, len + 1);
        used += len;
        size += len;
        float prob = whisper_full_get_segment_no_speech_prob(ctx, i);
        if (prob > noSpeech) noSpeech = prob;
    }
    if (!text) return -1;
    out->language = whisper_lang_str(lang);
    out->text = text;
    out->no_speech = noSpeech;
    return 0;
}
