package com.kdemarest.xlate;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** The running translation, newest at the bottom, built in code like Lens. */
public class MainActivity extends Activity implements ListenService.Listener {
    private static final int BACKGROUND = 0xFF101418, MUTED = 0xFF8A97A5, ACCENT = 0xFF4FC3F7, STOP = 0xFFE5534B;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<Entry, TextView[]> rows = new HashMap<>();
    private final Runnable meterTick = new Runnable() {
        @Override public void run() {
            meter.invalidate();
            main.postDelayed(this, 80);
        }
    };
    private LinearLayout list;
    private ScrollView scroll;
    private TextView statusLine, empty;
    private Button toggle;
    private Meter meter;
    private ModelStore model;
    private boolean downloading;

    /** The microphone's level, so a glance shows it is alive. */
    private static final class Meter extends View {
        private final Paint paint = new Paint();
        Meter(Context c) {
            super(c);
            paint.setColor(ACCENT);
        }
        @Override protected void onDraw(Canvas canvas) {
            canvas.drawRect(0, 0, getWidth() * ListenService.level, getHeight(), paint);
        }
    }

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        model = new ModelStore(getFilesDir());

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BACKGROUND);
        root.setFitsSystemWindows(true);

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(16), dp(8), dp(8), dp(4));
        statusLine = text(14, MUTED);
        top.addView(statusLine, new LinearLayout.LayoutParams(0, -2, 1));
        Button keyButton = new Button(this, null, android.R.attr.borderlessButtonStyle);
        keyButton.setText("API key");
        keyButton.setTextColor(MUTED);
        keyButton.setOnClickListener(v -> askForKey(false));
        top.addView(keyButton);
        root.addView(top);

        meter = new Meter(this);
        root.addView(meter, new LinearLayout.LayoutParams(-1, dp(3)));

        scroll = new ScrollView(this);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(16), dp(8), dp(16), dp(8));
        scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        empty = text(18, MUTED);
        empty.setText("Press Start and speak English or Spanish.\nHabla en inglés o en español.");
        empty.setPadding(0, dp(48), 0, 0);
        empty.setGravity(Gravity.CENTER);
        list.addView(empty);

        toggle = new Button(this);
        toggle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        toggle.setTextColor(Color.BLACK);
        toggle.setOnClickListener(v -> toggle());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(64));
        lp.setMargins(dp(16), dp(8), dp(16), dp(16));
        root.addView(toggle, lp);

        setContentView(root);
    }

    @Override protected void onStart() {
        super.onStart();
        ListenService.listener = this;
        for (Entry e : ListenService.entries) changed(e);
        status(ListenService.status);
        main.post(meterTick);
    }

    @Override protected void onStop() {
        super.onStop();
        ListenService.listener = null;
        main.removeCallbacks(meterTick);
    }

    private void toggle() {
        if (ListenService.running) {
            startService(new Intent(this, ListenService.class).setAction(ListenService.ACTION_STOP));
        } else {
            start();
        }
        main.postDelayed(this::refreshButton, 200);
    }

    /** Each missing piece asks for itself and comes back here, so first run walks through them all. */
    private void start() {
        if (downloading) return;
        if (key().isEmpty()) {
            askForKey(true);
        } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS}, 1);
        } else if (!model.ready()) {
            download();
        } else {
            askToStayAwake();
            ListenService.entries.clear();
            list.removeAllViews();
            rows.clear();
            startForegroundService(new Intent(this, ListenService.class));
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start();
        else status("Xlate needs the microphone");
    }

    private void download() {
        downloading = true;
        status("Fetching the speech model (264 MB, once)");
        new Thread(() -> {
            try {
                model.download(p -> main.post(() -> status("Fetching the speech model: " + p + "%")));
                main.post(() -> {
                    downloading = false;
                    start();
                    refreshButton();
                });
            } catch (IOException e) {
                main.post(() -> {
                    downloading = false;
                    status(e.getMessage());
                });
            }
        }, "model").start();
    }

    /** Samsung puts apps to sleep; this is the exemption that keeps a mic running for hours. */
    private void askToStayAwake() {
        if (getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName())) return;
        startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:" + getPackageName())));
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(ListenService.PREFS, Context.MODE_PRIVATE);
    }

    private String key() {
        return prefs().getString(ListenService.KEY_API, "");
    }

    private void askForKey(boolean thenStart) {
        EditText input = new EditText(this);
        input.setHint("sk-ant-...");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        new AlertDialog.Builder(this)
            .setTitle("Anthropic API key")
            .setMessage("Kept on this phone. Used only for translating.")
            .setView(input)
            .setPositiveButton("Save", (d, w) -> {
                String k = input.getText().toString().trim();
                if (k.isEmpty()) return;
                prefs().edit().putString(ListenService.KEY_API, k).apply();
                if (thenStart) start();
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    @Override public void changed(Entry e) {
        TextView[] row = rows.get(e);
        if (row == null) {
            list.removeView(empty);
            row = new TextView[] {text(12, MUTED), text(16, MUTED), text(24, Color.WHITE)};
            row[0].setPadding(0, dp(14), 0, dp(2));
            row[2].setPadding(0, dp(2), 0, 0);
            for (TextView t : row) list.addView(t);
            rows.put(e, row);
        }
        String time = new SimpleDateFormat("HH:mm:ss", Locale.ROOT).format(e.time);
        row[0].setText(time + "  " + e.language.toUpperCase(Locale.ROOT) + " → " + e.target().toUpperCase(Locale.ROOT));
        row[1].setText(e.text);
        if (e.translation != null) {
            row[2].setText(e.translation);
        } else if (e.problem != null) {
            row[2].setTextColor(STOP);
            row[2].setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            row[2].setText(e.problem);
        } else {
            row[2].setText("…");
        }
        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
    }

    @Override public void status(String s) {
        statusLine.setText(s);
        refreshButton();
    }

    private void refreshButton() {
        boolean on = ListenService.running;
        toggle.setText(on ? "Stop" : "Start");
        toggle.setBackgroundColor(on ? STOP : ACCENT);
    }

    private TextView text(int sp, int color) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setTextIsSelectable(false);
        return t;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
