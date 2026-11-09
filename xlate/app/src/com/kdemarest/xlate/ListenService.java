package com.kdemarest.xlate;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioRecordingConfiguration;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * Keeps the microphone open until the user says stop. Three threads, so a slow step never costs
 * audio: capture only reads the mic; transcribe and translate each work through a queue.
 */
public class ListenService extends Service {
    interface Listener {
        void changed(Entry entry);
        void status(String status);
    }

    static final String ACTION_STOP = "stop";
    static final String PREFS = "xlate";
    static final String KEY_API = "apiKey";
    private static final String CHANNEL = "listening";
    private static final int NOTIFICATION = 1, NOTIFICATION_STOPPED = 2;
    private static final int CONTEXT_UTTERANCES = 3;
    private static final int MAX_ENTRIES = 200;  // on screen; the transcript has them all

    static final List<Entry> entries = new ArrayList<>();
    static volatile boolean running;
    static volatile Listener listener;
    static volatile String status = "";
    static volatile float level;

    private static final class Clip {
        final float[] pcm;
        final Date time;
        Clip(float[] pcm, Date time) { this.pcm = pcm; this.time = time; }
    }
    private static final Clip END_OF_CLIPS = new Clip(null, null);
    private static final Entry END_OF_ENTRIES = new Entry(null, null, null);

    private final Handler main = new Handler(Looper.getMainLooper());
    private final LinkedBlockingQueue<Clip> clips = new LinkedBlockingQueue<>();
    private final LinkedBlockingQueue<Entry> toTranslate = new LinkedBlockingQueue<>();
    private PowerManager.WakeLock wakeLock;
    private AudioManager audio;
    private Transcript transcript;
    private volatile int sessionId;
    private volatile boolean silenced;
    private volatile String problem;
    private boolean started;

    private final AudioManager.AudioRecordingCallback silenceWatch = new AudioManager.AudioRecordingCallback() {
        @Override public void onRecordingConfigChanged(List<AudioRecordingConfiguration> configs) {
            boolean now = false;
            for (AudioRecordingConfiguration c : configs) {
                if (c.getClientAudioSessionId() == sessionId && c.isClientSilenced()) now = true;
            }
            silenced = now;
            refreshStatus();
        }
    };

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            running = false;  // the threads drain, then the last one stops the service
            setStatus("Finishing up");
            return START_NOT_STICKY;
        }
        if (started) return START_STICKY;
        try {
            startForeground(NOTIFICATION, notification("Listening"), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } catch (RuntimeException e) {
            // Android restarted us after a kill, and won't open a mic for an app in the background.
            notifyStopped();
            stopSelf();
            return START_NOT_STICKY;
        }
        started = true;
        begin();
        return START_STICKY;  // if the system kills us, come back
    }

    private void begin() {
        running = true;
        problem = null;
        audio = getSystemService(AudioManager.class);
        audio.registerAudioRecordingCallback(silenceWatch, main);
        wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "xlate:listening");
        wakeLock.acquire();
        try {
            transcript = new Transcript(getContentResolver(), new Date());
        } catch (IOException | RuntimeException e) {
            problem = "Transcript not saving: " + e.getMessage();
        }
        refreshStatus();
        new Thread(this::capture, "capture").start();
        new Thread(this::transcribe, "transcribe").start();
        new Thread(this::translate, "translate").start();
    }

    private void capture() {
        Segmenter segmenter = new Segmenter(pcm -> clips.add(new Clip(pcm, new Date())));
        short[] raw = new short[Segmenter.FRAME];
        float[] frame = new float[Segmenter.FRAME];
        while (running) {
            AudioRecord mic = openMic();
            if (mic == null) {
                problem = "Can't open the microphone; retrying";
                refreshStatus();
                pause(1000);
                continue;
            }
            problem = null;
            refreshStatus();
            sessionId = mic.getAudioSessionId();
            try {
                mic.startRecording();
                while (running) {
                    int got = 0;
                    while (got < raw.length) {
                        int n = mic.read(raw, got, raw.length - got);
                        if (n <= 0) throw new IOException("mic read " + n);
                        got += n;
                    }
                    for (int i = 0; i < raw.length; i++) frame[i] = raw[i] / 32768f;
                    segmenter.feed(frame);
                    level = segmenter.level();
                }
            } catch (IOException | RuntimeException e) {
                problem = "Microphone dropped; reopening";  // the outer loop reopens it
                refreshStatus();
            } finally {
                try { mic.stop(); } catch (RuntimeException ignored) { }
                mic.release();
            }
        }
        segmenter.flush();
        level = 0;
        clips.add(END_OF_CLIPS);
    }

    private AudioRecord openMic() {
        int min = AudioRecord.getMinBufferSize(Segmenter.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        try {
            AudioRecord mic = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, Segmenter.RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, Segmenter.RATE * 2 * 2));
            if (mic.getState() == AudioRecord.STATE_INITIALIZED) return mic;
            mic.release();
        } catch (RuntimeException ignored) { }
        return null;
    }

    private void transcribe() {
        Whisper whisper = null;
        try {
            whisper = new Whisper(new ModelStore(getFilesDir()).path());
            for (Clip clip = clips.take(); clip != END_OF_CLIPS; clip = clips.take()) {
                refreshStatus();
                Whisper.Result r = whisper.transcribe(clip.pcm);
                if (r == null || Noise.isNoise(r.text, r.noSpeech)) continue;
                Entry entry = new Entry(clip.time, r.language, r.text);
                publish(entry);
                toTranslate.add(entry);
            }
        } catch (InterruptedException ignored) {
        } catch (RuntimeException | UnsatisfiedLinkError e) {
            problem = "Speech recognition failed: " + e.getMessage();
            refreshStatus();
        } finally {
            if (whisper != null) whisper.close();
            toTranslate.add(END_OF_ENTRIES);
        }
    }

    private void translate() {
        String key = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_API, "");
        Translator translator = new Translator(key);
        ArrayDeque<String> recent = new ArrayDeque<>();
        try {
            for (Entry e = toTranslate.take(); e != END_OF_ENTRIES; e = toTranslate.take()) {
                try {
                    Translator.Result r = translator.translate(e.text, new ArrayList<>(recent));
                    e.language = r.language;  // Claude read the words; it outranks whisper's guess
                    e.translation = r.translation;
                } catch (Translator.Fatal | IOException | RuntimeException failure) {
                    e.problem = failure.getMessage();
                }
                recent.addLast(e.text);
                if (recent.size() > CONTEXT_UTTERANCES) recent.removeFirst();
                write(e);
                publish(e);
                refreshStatus();
            }
        } catch (InterruptedException ignored) {
        }
        main.post(this::finish);
    }

    private void write(Entry e) {
        if (transcript == null) return;
        try {
            transcript.append(Transcript.format(e));
        } catch (IOException | RuntimeException failure) {
            problem = "Transcript not saving: " + failure.getMessage();
        }
    }

    private void finish() {
        audio.unregisterAudioRecordingCallback(silenceWatch);
        if (wakeLock.isHeld()) wakeLock.release();
        setStatus(transcript != null ? "Saved Documents/xlate/" + transcript.name : "Stopped");
        started = false;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void publish(Entry e) {
        main.post(() -> {
            if (!entries.contains(e)) {
                entries.add(e);
                if (entries.size() > MAX_ENTRIES) entries.remove(0);
            }
            Listener l = listener;
            if (l != null) l.changed(e);
        });
    }

    private void refreshStatus() {
        String s;
        int waiting = clips.size() + toTranslate.size();
        if (problem != null) s = problem;
        else if (silenced) s = "Another app has the microphone";
        else if (waiting > 0) s = "Listening, " + waiting + " behind";
        else s = "Listening";
        setStatus(s);
    }

    private void setStatus(String s) {
        status = s;
        main.post(() -> {
            Listener l = listener;
            if (l != null) l.status(s);
        });
    }

    private Notification notification(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Listening", NotificationManager.IMPORTANCE_LOW));
        Intent stop = new Intent(this, ListenService.class).setAction(ACTION_STOP);
        return new Notification.Builder(this, CHANNEL)
            .setContentTitle("Xlate")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .setContentIntent(openApp())
            .addAction(new Notification.Action.Builder(null, "Stop",
                PendingIntent.getService(this, 0, stop, PendingIntent.FLAG_IMMUTABLE)).build())
            .build();
    }

    /** The one way the mic can end without being told to: say so rather than fail silently. */
    private void notifyStopped() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL + "-stopped", "Stopped", NotificationManager.IMPORTANCE_HIGH));
        nm.notify(NOTIFICATION_STOPPED, new Notification.Builder(this, CHANNEL + "-stopped")
            .setContentTitle("Xlate stopped listening")
            .setContentText("Android closed it. Tap to start again.")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(openApp())
            .setAutoCancel(true)
            .build());
    }

    private PendingIntent openApp() {
        return PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
    }

    private static void pause(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { }
    }
}
