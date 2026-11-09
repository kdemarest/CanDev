// JNI glue between Whisper.java and xlate_core.c.
#include <jni.h>
#include <stdio.h>
#include <stdlib.h>
#include "xlate_core.h"

JNIEXPORT jlong JNICALL Java_com_kdemarest_xlate_Whisper_init(JNIEnv *env, jclass cls, jstring path) {
    const char *model = (*env)->GetStringUTFChars(env, path, NULL);
    struct whisper_context_params cp = whisper_context_default_params();
    cp.use_gpu = false;
    struct whisper_context *ctx = whisper_init_from_file_with_params(model, cp);
    (*env)->ReleaseStringUTFChars(env, path, model);
    return (jlong)(intptr_t)ctx;
}

JNIEXPORT void JNICALL Java_com_kdemarest_xlate_Whisper_free(JNIEnv *env, jclass cls, jlong handle) {
    if (handle) whisper_free((struct whisper_context *)(intptr_t)handle);
}

// Returns { language, text, noSpeechProbability }, or null if whisper failed.
JNIEXPORT jobjectArray JNICALL Java_com_kdemarest_xlate_Whisper_transcribe(
        JNIEnv *env, jclass cls, jlong handle, jfloatArray audio, jint threads) {
    jsize n = (*env)->GetArrayLength(env, audio);
    jfloat *pcm = (*env)->GetFloatArrayElements(env, audio, NULL);
    struct xlate_result r;
    int rc = xlate_transcribe((struct whisper_context *)(intptr_t)handle, pcm, n, threads, &r);
    (*env)->ReleaseFloatArrayElements(env, audio, pcm, JNI_ABORT);
    if (rc != 0) return NULL;

    char prob[16];
    snprintf(prob, sizeof prob, "%.3f", r.no_speech);
    jobjectArray out = (*env)->NewObjectArray(env, 3, (*env)->FindClass(env, "java/lang/String"), NULL);
    (*env)->SetObjectArrayElement(env, out, 0, (*env)->NewStringUTF(env, r.language));
    (*env)->SetObjectArrayElement(env, out, 1, (*env)->NewStringUTF(env, r.text));
    (*env)->SetObjectArrayElement(env, out, 2, (*env)->NewStringUTF(env, prob));
    free(r.text);
    return out;
}
