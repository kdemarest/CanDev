package com.kdemarest.xlate;

import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Paths;

/** Cuts a raw f32le 16 kHz recording with the real Segmenter: Clips in.f32 outPrefix */
public class Clips {
    public static void main(String[] a) throws IOException {
        ByteBuffer b = ByteBuffer.wrap(Files.readAllBytes(Paths.get(a[0]))).order(ByteOrder.LITTLE_ENDIAN);
        int[] count = {0};
        Segmenter s = new Segmenter(pcm -> {
            String name = String.format("%s-%03d.f32", a[1], count[0]++);
            ByteBuffer o = ByteBuffer.allocate(pcm.length * 4).order(ByteOrder.LITTLE_ENDIAN);
            for (float v : pcm) o.putFloat(v);
            try (FileOutputStream f = new FileOutputStream(name)) { f.write(o.array()); }
            catch (IOException e) { throw new RuntimeException(e); }
        });
        float[] frame = new float[Segmenter.FRAME];
        while (b.remaining() >= frame.length * 4) {
            for (int i = 0; i < frame.length; i++) frame[i] = b.getFloat();
            s.feed(frame);
        }
        s.flush();
        System.out.println(a[1] + ": " + count[0] + " clips");
    }
}
