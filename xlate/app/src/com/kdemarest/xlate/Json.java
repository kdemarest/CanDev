package com.kdemarest.xlate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Just enough JSON for the Messages API, and unlike org.json it also runs in the JVM tests. */
final class Json {
    private final String s;
    private int i;

    private Json(String s) { this.s = s; }

    /** @return Map, List, String, Double, Boolean or null. */
    static Object parse(String text) {
        Json p = new Json(text);
        Object v = p.value();
        p.space();
        if (p.i != text.length()) throw p.bad("trailing text");
        return v;
    }

    static String quote(String v) {
        StringBuilder b = new StringBuilder("\"");
        for (int k = 0; k < v.length(); k++) {
            char c = v.charAt(k);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    private Object value() {
        space();
        if (i >= s.length()) throw bad("unexpected end");
        char c = s.charAt(i);
        if (c == '{') return object();
        if (c == '[') return array();
        if (c == '"') return string();
        if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
        if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
        if (s.startsWith("null", i)) { i += 4; return null; }
        int start = i;
        while (i < s.length() && "+-.eE0123456789".indexOf(s.charAt(i)) >= 0) i++;
        if (start == i) throw bad("unexpected character");
        return Double.valueOf(s.substring(start, i));
    }

    private Map<String, Object> object() {
        Map<String, Object> m = new LinkedHashMap<>();
        i++;
        space();
        if (peek() == '}') { i++; return m; }
        while (true) {
            space();
            if (peek() != '"') throw bad("expected a key");
            String k = string();
            space();
            if (peek() != ':') throw bad("expected :");
            i++;
            m.put(k, value());
            space();
            char c = peek();
            i++;
            if (c == '}') return m;
            if (c != ',') throw bad("expected , or }");
        }
    }

    private List<Object> array() {
        List<Object> l = new ArrayList<>();
        i++;
        space();
        if (peek() == ']') { i++; return l; }
        while (true) {
            l.add(value());
            space();
            char c = peek();
            i++;
            if (c == ']') return l;
            if (c != ',') throw bad("expected , or ]");
        }
    }

    private String string() {
        StringBuilder b = new StringBuilder();
        i++;
        while (true) {
            if (i >= s.length()) throw bad("unterminated string");
            char c = s.charAt(i++);
            if (c == '"') return b.toString();
            if (c != '\\') { b.append(c); continue; }
            if (i >= s.length()) throw bad("unterminated escape");
            char e = s.charAt(i++);
            switch (e) {
                case 'n': b.append('\n'); break;
                case 't': b.append('\t'); break;
                case 'r': b.append('\r'); break;
                case 'b': b.append('\b'); break;
                case 'f': b.append('\f'); break;
                case 'u':
                    if (i + 4 > s.length()) throw bad("short \\u escape");
                    b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                    i += 4;
                    break;
                default: b.append(e);  // " \ /
            }
        }
    }

    private char peek() {
        if (i >= s.length()) throw bad("unexpected end");
        return s.charAt(i);
    }

    private void space() {
        while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
    }

    private IllegalArgumentException bad(String why) {
        return new IllegalArgumentException("JSON: " + why + " at " + i);
    }
}
