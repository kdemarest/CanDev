// Runs the app's transcription over clips from test/Clips.java and reports speed and language.
//   bench <model> <threads> <expected language> <clip.f32>...
// Build after build.sh, with W the whisper.cpp folder in ~/.cache/xlate-build/dl:
//   clang -O2 -I$W/include -I$W/ggml/include -Inative test/bench.c native/xlate_core.c -o bench \
//     -Wl,--start-group $W/build/src/libwhisper.a $W/build/ggml/src/libggml*.a -Wl,--end-group -lc++_shared -lm -ldl
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include "xlate_core.h"

static void quiet(enum ggml_log_level level, const char *text, void *user) {}

static double now(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec + t.tv_nsec / 1e9;
}

int main(int argc, char **argv) {
    whisper_log_set(quiet, NULL);
    struct whisper_context_params cp = whisper_context_default_params();
    cp.use_gpu = false;
    struct whisper_context *ctx = whisper_init_from_file_with_params(argv[1], cp);
    if (!ctx) return 1;
    int threads = atoi(argv[2]), right = 0, clips = 0, retried = 0;
    double audio = 0, spent = 0, worst = 0;
    for (int i = 4; i < argc; i++) {
        FILE *f = fopen(argv[i], "rb");
        fseek(f, 0, SEEK_END);
        int n = ftell(f) / 4;
        rewind(f);
        float *pcm = malloc(n * 4);
        fread(pcm, 4, n, f);
        fclose(f);
        struct xlate_result r;
        double t = now();
        if (xlate_transcribe(ctx, pcm, n, threads, &r) != 0) return 1;
        double took = now() - t, secs = n / 16000.0;
        audio += secs; spent += took; clips++;
        if (took > worst) worst = took;
        retried += r.retried;
        int ok = r.language[0] == argv[3][0] && r.language[1] == argv[3][1];
        right += ok;
        printf("%5.1fs in %5.2fs %s%s ns=%.2f |%s\n", secs, took, r.language, ok ? "" : " WRONG", r.no_speech, r.text);
        fflush(stdout);
        free(r.text); free(pcm);
    }
    printf("== %d/%d language right, %d retried, %.0fs audio in %.0fs: %.2fx realtime, worst clip %.1fs\n",
           right, clips, retried, audio, spent, audio / spent, worst);
    return 0;
}
