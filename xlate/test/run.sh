#!/data/data/com.termux/files/usr/bin/bash
# Compiles the app and runs test/XlateTest.java on the plain JVM. The classes that need Android
# only have to compile here: android.jar is stubs, so what runs is the Android-free logic.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_JAR="$HOME/.local/share/xlate/android-36.jar"
[ -f "$ANDROID_JAR" ] || ANDROID_JAR="$HOME/.local/share/lens/android-36.jar"
OUT="$HOME/.cache/xlate-build/test"
rm -rf "$OUT" && mkdir -p "$OUT"
mapfile -t sources < <(find "$DIR/app/src" -name '*.java')
javac --release 11 -Xlint:all,-options,-serial -cp "$ANDROID_JAR" -d "$OUT" "${sources[@]}"
javac -Xlint:-options -nowarn -cp "$OUT:$ANDROID_JAR" -d "$OUT" "$DIR/test/XlateTest.java"
java -cp "$OUT:$ANDROID_JAR" com.kdemarest.xlate.XlateTest
