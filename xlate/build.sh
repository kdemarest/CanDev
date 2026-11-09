#!/data/data/com.termux/files/usr/bin/bash
# Builds Xlate on the phone, no Gradle, the way lens/build.sh does, plus one native library:
# whisper.cpp at a pinned version, linked with native/xlate_jni.c into libxlate.so.
#   bash build.sh            build, and copy the APK to Downloads to install from there
#   bash build.sh --no-install
# Needs: pkg install openjdk-21 aapt aapt2 d8 apksigner cmake
# Build output stays in ~/.cache (sdcard is noexec and slow). The native library is cached by its
# inputs, so only the first build or a change to native/ pays for compiling whisper; a Java change
# rebuilds in seconds. The platform jar and signing key live in ~/.local/share/xlate. The key is
# made on first build: if it is ever lost, Android refuses the update until Xlate is uninstalled.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK="$HOME/.local/share/xlate"
CACHE="$HOME/.cache/xlate-build"
OUT="$CACHE/apk"
PLATFORM_URL="https://dl.google.com/android/repository/platform-36_r02.zip"
PLATFORM_SHA1="2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576"
ANDROID_JAR="$SDK/android-36.jar"
KEYSTORE="$SDK/debug.keystore"
WHISPER_VERSION=1.9.5
WHISPER_SHA256=ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720
WHISPER_TAR="$CACHE/dl/whisper-$WHISPER_VERSION.tar.gz"
WHISPER="$CACHE/dl/whisper.cpp-$WHISPER_VERSION"
MIN_SDK=29
TARGET_SDK=34

for cmd in javac keytool aapt aapt2 d8 zipalign apksigner unzip curl cmake clang sha256sum; do
  command -v "$cmd" >/dev/null || { echo "Missing $cmd. Run: pkg install openjdk-21 aapt aapt2 d8 apksigner cmake" >&2; exit 1; }
done
mkdir -p "$SDK" "$CACHE/dl"

if [ ! -f "$ANDROID_JAR" ]; then
  if [ -f "$HOME/.local/share/lens/android-36.jar" ]; then
    cp "$HOME/.local/share/lens/android-36.jar" "$ANDROID_JAR"
  else
    echo "xlate: fetching Android platform 36 (66 MB, once)"
    tmp="$SDK/platform.zip"
    curl -fsSL -o "$tmp" "$PLATFORM_URL"
    echo "$PLATFORM_SHA1  $tmp" | sha1sum -c --quiet
    unzip -p "$tmp" '*/android.jar' > "$ANDROID_JAR.part"
    mv "$ANDROID_JAR.part" "$ANDROID_JAR"
    rm -f "$tmp"
  fi
fi

if [ ! -f "$KEYSTORE" ]; then
  echo "xlate: making the signing key $KEYSTORE"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias xlate \
    -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=Xlate" >/dev/null 2>&1
fi

# Native library, rebuilt only when whisper's version, the glue or this script's flags change.
NATIVE_KEY="$(cat "$DIR"/native/xlate_* <(sed -n '/^# native-begin/,/^# native-end/p' "$0") | sha256sum | cut -c1-16)"
NATIVE="$CACHE/native-$NATIVE_KEY"
if [ ! -f "$NATIVE/lib/arm64-v8a/libxlate.so" ]; then
# native-begin
  [ -f "$WHISPER_TAR" ] || curl -fsSL -o "$WHISPER_TAR" \
    "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v$WHISPER_VERSION.tar.gz"
  echo "$WHISPER_SHA256  $WHISPER_TAR" | sha256sum -c --quiet
  [ -d "$WHISPER" ] || tar xzf "$WHISPER_TAR" -C "$CACHE/dl"
  echo "xlate: compiling whisper.cpp $WHISPER_VERSION (a few minutes, once)"
  # armv8.2 with dotprod and fp16: any arm64 phone since about 2019.
  cmake -S "$WHISPER" -B "$WHISPER/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF \
    -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16 \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=OFF >/dev/null
  cmake --build "$WHISPER/build" -j"$(nproc)" >/dev/null
  mkdir -p "$NATIVE/lib/arm64-v8a"
  JNI="$(dirname "$(find "$PREFIX/lib/jvm" -name jni.h | head -1)")"
  # Termux's libc++ goes in the APK too: the app can't see Termux's lib folder.
  clang -shared -fPIC -O2 -Wl,-z,max-page-size=16384 \
    -I"$WHISPER/include" -I"$WHISPER/ggml/include" -I"$JNI" -I"$JNI/linux" \
    "$DIR/native/xlate_jni.c" "$DIR/native/xlate_core.c" -o "$NATIVE/lib/arm64-v8a/libxlate.so" \
    -Wl,--start-group "$WHISPER/build/src/libwhisper.a" "$WHISPER"/build/ggml/src/libggml*.a -Wl,--end-group \
    -lc++_shared -lm -ldl
  cp "$PREFIX/lib/libc++_shared.so" "$NATIVE/lib/arm64-v8a/"
# native-end
fi

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex"

aapt2 link -o "$OUT/base.apk" --manifest "$DIR/app/AndroidManifest.xml" -I "$ANDROID_JAR" \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  --version-code "$(date +%s)" --version-name "$(date +%Y.%m.%d)"

mapfile -t sources < <(find "$DIR/app/src" -name '*.java')
javac --release 11 -Xlint:-options -XDsuppressNotes -cp "$ANDROID_JAR" -d "$OUT/classes" "${sources[@]}"

mapfile -t classes < <(find "$OUT/classes" -name '*.class')
d8 --release --min-api "$MIN_SDK" --lib "$ANDROID_JAR" --output "$OUT/dex" "${classes[@]}"
(cd "$OUT/dex" && aapt add "$OUT/base.apk" classes.dex >/dev/null)
(cd "$NATIVE" && aapt add "$OUT/base.apk" lib/arm64-v8a/libxlate.so lib/arm64-v8a/libc++_shared.so >/dev/null)

zipalign -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"
apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android --ks-key-alias xlate \
  --out "$OUT/xlate.apk" "$OUT/aligned.apk"
echo "xlate: built $OUT/xlate.apk"

# The installer can't read Termux's private files, so install from Downloads (My Files → Downloads).
if [ "${1:-}" != "--no-install" ]; then
  cp "$OUT/xlate.apk" /storage/emulated/0/Download/xlate.apk
  echo "xlate: open My Files → Downloads → xlate.apk and tap Install (or Update)"
fi
