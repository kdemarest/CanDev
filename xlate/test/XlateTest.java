package com.kdemarest.xlate;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** The parts with no Android in them, on the plain JVM: bash test/run.sh */
public class XlateTest {
    static int failed, passed;
    static void check(String what, boolean ok) {
        if (ok) passed++; else { failed++; System.out.println("FAIL " + what); }
    }

    // ---- Segmenter, fed synthetic audio: noise at `noise`, with bursts of louder "speech"
    static final Random rnd = new Random(7);
    static List<float[]> out;
    static Segmenter seg() { out = new ArrayList<>(); return new Segmenter(out::add); }
    static void play(Segmenter s, double seconds, float amp) {
        int n = (int) (seconds * 16000 / Segmenter.FRAME);
        float[] f = new float[Segmenter.FRAME];
        for (int i = 0; i < n; i++) {
            for (int k = 0; k < f.length; k++) f[k] = (float) (rnd.nextGaussian() * amp);
            s.feed(f);
        }
    }
    /** Real speech dips between syllables; flat noise at this level is what a fan looks like. */
    static void talk(Segmenter s, double seconds) { talk(s, seconds, 0.001f); }
    static void talk(Segmenter s, double seconds, float room) {
        int n = (int) (seconds * 16000 / Segmenter.FRAME);
        float[] f = new float[Segmenter.FRAME];
        for (int i = 0; i < n; i++) {
            float amp = i % 8 < 6 ? 0.1f : room;
            for (int k = 0; k < f.length; k++) f[k] = (float) (rnd.nextGaussian() * amp);
            s.feed(f);
        }
    }
    static double secs(float[] pcm) { return pcm.length / 16000.0; }

    static void segmenter() {
        Segmenter s = seg();
        play(s, 3, 0.001f);
        check("silence yields nothing", out.isEmpty());
        play(s, 2, 0.1f); play(s, 1.5, 0.001f);
        check("one utterance", out.size() == 1);
        check("utterance about 2s + pre-roll and tail: " + secs(out.get(0)), secs(out.get(0)) > 2.2 && secs(out.get(0)) < 2.9);

        s = seg(); play(s, 2, 0.001f); play(s, 0.15, 0.1f); play(s, 2, 0.001f);
        check("a cough is dropped", out.isEmpty());

        s = seg(); play(s, 2, 0.001f); play(s, 1, 0.1f); play(s, 0.3, 0.001f); play(s, 1, 0.1f); play(s, 1.5, 0.001f);
        check("a short breath doesn't split a sentence", out.size() == 1);

        s = seg(); play(s, 2, 0.001f); play(s, 1, 0.1f); play(s, 1.2, 0.001f); play(s, 1, 0.1f); play(s, 1.5, 0.001f);
        check("a real pause does: " + out.size(), out.size() == 2);

        s = seg(); play(s, 2, 0.001f); talk(s, 65); play(s, 1.5, 0.001f);
        double total = 0, longest = 0;
        for (float[] u : out) { total += secs(u); longest = Math.max(longest, secs(u)); }
        check("nonstop talk is cut: " + out.size(), out.size() >= 3);
        check("no piece over 8s: " + longest, longest <= 8.4);
        StringBuilder pieces = new StringBuilder();
        for (float[] u : out) pieces.append(String.format(" %.2f", secs(u)));
        check("nothing lost from 65s: " + total + " =" + pieces, total > 65 && total < 66.5);

        s = seg(); play(s, 3, 0.02f); play(s, 2, 0.2f); play(s, 1.5, 0.02f);
        check("speech over a noisy room: " + out.size(), out.size() == 1);

        s = seg(); play(s, 2, 0.001f); play(s, 70, 0.05f); int cuts = out.size(); play(s, 30, 0.05f);
        check("a fan that starts is learned, not transcribed forever: " + cuts + " then " + out.size(), out.size() <= cuts + 2);

        s = seg(); play(s, 0.3, 0.1f); play(s, 0.3, 0.001f); play(s, 2, 0.001f); talk(s, 2); play(s, 1.5, 0.001f);
        check("talking during warm-up doesn't deafen it: " + out.size(), out.size() == 1);

        s = seg(); play(s, 0.2, 0f); play(s, 2, 0.01f); talk(s, 2, 0.01f); play(s, 1.5, 0.01f);
        check("mic opens with digital silence, then a normal room: " + out.size(), out.size() == 1);

        s = seg(); play(s, 2, 0.001f); play(s, 1, 0.1f); s.flush();
        check("stop mid-sentence keeps it", out.size() == 1);
    }

    // ---- Json
    @SuppressWarnings("unchecked")
    static void json() {
        Map<String, Object> m = (Map<String, Object>) Json.parse(" {\"a\": [1, 2.5e1, true, null, {}], \"b\":\"s\\u00ed\\n\\\"q\\\"\", \"c\":[]} ");
        check("numbers", ((List<Object>) m.get("a")).get(1).equals(25.0));
        check("null", ((List<Object>) m.get("a")).get(3) == null);
        check("escapes", "sí\n\"q\"".equals(m.get("b")));
        String tricky = "¿Qué? \"comillas\" \\ back\nline\ttab \u0001 end";
        check("quote round trip", tricky.equals(Json.parse(Json.quote(tricky))));
        for (String bad : new String[] {"{", "[1,", "\"x", "{\"a\" 1}", "1 2", ""}) {
            boolean threw = false;
            try { Json.parse(bad); } catch (IllegalArgumentException e) { threw = true; }
            check("rejects " + bad, threw);
        }
    }

    // ---- Noise
    static void noise() {
        check("real speech", !Noise.isNoise("Hola, ¿cómo estás?", 0.01f));
        check("gracias alone is real", !Noise.isNoise("Gracias.", 0.02f));
        check("thank you alone is real", !Noise.isNoise("Thank you.", 0.02f));
        check("empty", Noise.isNoise("  ", 0));
        check("punctuation", Noise.isNoise("...", 0));
        check("[Música]", Noise.isNoise("[Música]", 0));
        check("(applause)", Noise.isNoise("(applause)", 0));
        check("Amara", Noise.isNoise("Subtítulos realizados por la comunidad de Amara.org", 0));
        check("video thanks", Noise.isNoise("¡Gracias por ver el video!", 0));
        check("no speech prob", Noise.isNoise("Hola", 0.95f));
        check("real speech can score high", !Noise.isNoise("Hija del maestro de escuela", 0.74f));
    }

    // ---- Translator against a local stand-in for the API
    static String reply(String json) {
        return "{\"id\":\"m\",\"type\":\"message\",\"role\":\"assistant\",\"stop_reason\":\"end_turn\",\"content\":["
            + "{\"type\":\"thinking\",\"thinking\":\"\",\"signature\":\"x\"},"
            + "{\"type\":\"text\",\"text\":" + Json.quote(json) + "}]}";
    }

    @SuppressWarnings("unchecked")
    static void translator() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        AtomicReference<String> seen = new AtomicReference<>(), key = new AtomicReference<>(), version = new AtomicReference<>();
        String[] bodies = {reply("{\"language\":\"es\",\"translation\":\"Hello, \\\"friend\\\"\"}")};
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/messages", x -> {
            int n = calls.getAndIncrement();
            seen.set(new String(x.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            key.set(x.getRequestHeaders().getFirst("x-api-key"));
            version.set(x.getRequestHeaders().getFirst("anthropic-version"));
            byte[] b = bodies[0].getBytes(StandardCharsets.UTF_8);
            x.sendResponseHeaders(200, b.length);
            x.getResponseBody().write(b);
            x.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1/messages";
        Translator t = new Translator(url, "test-key");

        Translator.Result r = t.translate("Hola, \"amigo\"", Arrays.asList("Buenos días"));
        check("skips the thinking block", "Hello, \"friend\"".equals(r.translation));
        check("language", "es".equals(r.language));
        check("key header", "test-key".equals(key.get()));
        check("version header", "2026-10-21".equals(version.get()));
        Map<String, Object> body = (Map<String, Object>) Json.parse(seen.get());
        check("model is Haiku", "claude-haiku-5-5".equals(body.get("model")));
        check("no sampling params", !body.containsKey("temperature") && !body.containsKey("top_p"));
        Map<String, Object> cfg = (Map<String, Object>) body.get("output_config");
        check("effort low", "low".equals(cfg.get("effort")));
        check("json schema", "json_schema".equals(((Map<String, Object>) cfg.get("format")).get("type")));
        String user = (String) ((Map<String, Object>) ((List<Object>) body.get("messages")).get(0)).get("content");
        check("utterance sent", user.contains("<utterance>Hola, \"amigo\"</utterance>"));
        check("context sent", user.contains("<earlier>\nBuenos días\n</earlier>"));

        calls.set(0);
        int[] s1 = {429, 503, 200};
        server.removeContext("/v1/messages");
        server.createContext("/v1/messages", x -> {
            int n = calls.getAndIncrement();
            byte[] b = bodies[0].getBytes(StandardCharsets.UTF_8);
            x.sendResponseHeaders(s1[Math.min(n, 2)], b.length);
            x.getResponseBody().write(b);
            x.close();
        });
        check("retries 429 and 5xx", t.translate("x", new ArrayList<>()).translation != null && calls.get() == 3);

        server.removeContext("/v1/messages");
        calls.set(0);
        server.createContext("/v1/messages", x -> {
            calls.incrementAndGet();
            byte[] b = "{\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"bad\"}}".getBytes(StandardCharsets.UTF_8);
            x.sendResponseHeaders(401, b.length);
            x.getResponseBody().write(b);
            x.close();
        });
        String why = null;
        try { t.translate("x", new ArrayList<>()); } catch (Translator.Fatal e) { why = e.getMessage(); }
        check("bad key is fatal, one call: " + calls.get(), why != null && why.contains("API key") && calls.get() == 1);
        server.stop(0);

        why = null;
        try { Translator.parse("{\"stop_reason\":\"refusal\",\"content\":[]}"); } catch (Translator.Fatal e) { why = e.getMessage(); }
        check("refusal surfaces", why != null && why.contains("declined"));
        why = null;
        try { Translator.parse("{\"stop_reason\":\"max_tokens\",\"content\":[{\"type\":\"thinking\"}]}"); } catch (Translator.Fatal e) { why = e.getMessage(); }
        check("cut off surfaces", why != null && why.contains("cut off"));
    }

    // ---- Transcript text
    static void transcript() {
        Date d = new Date(126, 10, 6, 7, 5, 9);
        check("file name: " + Transcript.fileName(d), "26-11-06-07-05.md".equals(Transcript.fileName(d)));
        check("header", "# Transcript 2026-11-06 07:05\n\n".equals(Transcript.header(d)));
        Entry e = new Entry(d, "es", "Hola");
        e.translation = "Hello";
        check("entry", "**07:05:09 ES → EN**\n\nHola\n\n> Hello\n\n".equals(Transcript.format(e)));
        Entry f = new Entry(d, "en", "Hi");
        f.problem = "offline";
        check("failed entry keeps the original", "**07:05:09 EN → ES**\n\nHi\n\n> _(not translated: offline)_\n\n".equals(Transcript.format(f)));
    }

    public static void main(String[] a) throws Exception {
        segmenter(); json(); noise(); transcript(); translator();
        System.out.println(passed + " passed, " + failed + " failed");
        System.exit(failed == 0 ? 0 : 1);
    }
}
