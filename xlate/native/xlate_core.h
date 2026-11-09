#pragma once
#include "whisper.h"

struct xlate_result {
    const char *language;  // "en" or "es"
    char *text;            // the caller frees it
    float no_speech;
    int retried;           // detection left en/es, so it was transcribed twice
};

// pcm: mono 16 kHz, -1 to 1. Returns 0 on success.
int xlate_transcribe(struct whisper_context *ctx, const float *pcm, int n, int threads, struct xlate_result *out);
