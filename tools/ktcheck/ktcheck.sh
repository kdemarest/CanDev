#!/data/data/com.termux/files/usr/bin/bash
# ktcheck: type-check an Android Kotlin app on the phone, without the Android SDK or Gradle.
#   bash tools/ktcheck/ktcheck.sh [--full] [--no-server] [PROJECT]   (PROJECT defaults to .)
#   bash tools/ktcheck/ktcheck.sh --stop                              stop the compile server
#   bash tools/ktcheck/ktcheck.sh --prepare PROJECT                   download/build only (setup.sh)
# Checks app/src/main/{java,kotlin}/**/*.kt against android.jar, the app's dependencies from
# app/build.gradle.kts (AAR classes, transitive compile deps) and a stub R built from res/.
# Prints compiler messages as file:line:col; exits 1 on errors. See README.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_HOME="${TOOLS_HOME:-$HOME/.local/share/devenv-tools}"
CACHE="$TOOLS_HOME/ktcheck"
PY=(python3 -I "$HERE/ktcheck.py")
SOCK="$CACHE/server/ktserver.sock"

mode=check server=true prepare=false project=.
for a in "$@"; do
  case "$a" in
    --full) mode=full ;;          # also run the backend (catches JVM-signature clashes etc.)
    --no-server) server=false ;;  # one-shot kotlinc, nothing left running
    --prepare) prepare=true ;;
    --stop) "${PY[@]}" run "$SOCK" stop "" >/dev/null 2>&1 || true; exit 0 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    -*) echo "ktcheck: unknown option $a" >&2; exit 2 ;;
    *) project="$a" ;;
  esac
done

command -v kotlinc >/dev/null || { echo "ktcheck: kotlinc missing. Run: pkg install kotlin" >&2; exit 2; }
KOTLIN_HOME="$(cd "$(dirname "$(readlink -f "$(command -v kotlinc)")")/.." && pwd)"
KLIB="$KOTLIN_HOME/lib"

project="$(cd "$project" && pwd)"
app="$project"
[ -d "$project/app/src/main" ] && app="$project/app"
gradle="$app/build.gradle.kts"
[ -f "$gradle" ] || gradle="$app/build.gradle"
[ -f "$gradle" ] || { echo "ktcheck: no build.gradle(.kts) in $app" >&2; exit 2; }
main="$app/src/main"

# What the build file declares: namespace, compileSdk, jvmTarget, plugins, dependencies.
gradle_text="$(sed 's://.*$::' "$gradle")"
namespace="$(grep -oE 'namespace *=? *"[^"]+"' <<<"$gradle_text" | head -1 | sed -E 's/.*"(.*)"/\1/' || true)"
[ -n "$namespace" ] || namespace="$(grep -oE 'package="[^"]+"' "$main/AndroidManifest.xml" | head -1 | sed -E 's/.*"(.*)"/\1/' || true)"
sdk="$(grep -oE 'compileSdk *=? *[0-9]+' <<<"$gradle_text" | grep -oE '[0-9]+$' | head -1 || true)"
sdk="${sdk:-34}"
jvm_target="$(grep -oE 'jvmTarget *=? *"[0-9.]+"' <<<"$gradle_text" | grep -oE '[0-9.]+' | head -1 || true)"
jvm_target="${jvm_target:-17}"
mapfile -t coords < <(grep -oE '(implementation|api)\( *"[^":]+:[^":]+:[^"]+"' <<<"$gradle_text" | sed -E 's/.*"(.*)"/\1/' | sort -u)
plugin_args=()
if grep -qE 'plugin\.serialization|kotlin\("plugin\.serialization"\)|kotlinx-serialization' <<<"$gradle_text"; then
  plugin_args+=("-Xplugin=$KLIB/kotlinx-serialization-compiler-plugin.jar")
fi

mkdir -p "$CACHE/cp" "$CACHE/gen" "$CACHE/server"

# android.jar for compileSdk (downloaded once).
android_jar="$CACHE/android-$sdk/android.jar"
[ -f "$android_jar" ] || "${PY[@]}" android "$CACHE" "$sdk"

# Dependency classpath, keyed by the dependency list (resolved and downloaded once per list).
cp_key="$(printf '%s\n' "${coords[@]}" "$(cksum <"$HERE/ktcheck.py")" | cksum | cut -d' ' -f1)"
cp_file="$CACHE/cp/$cp_key.txt"
[ -f "$cp_file" ] || "${PY[@]}" deps "$CACHE" "$cp_file" "${coords[@]}"
deps_cp="$(paste -sd: "$cp_file")"

# The compile server: rebuilt when KtServer.kt or the kotlin package changes.
server_jar="$CACHE/server/ktserver.jar"
server_stamp="$(cat "$KOTLIN_HOME/build.txt" 2>/dev/null; cksum <"$HERE/KtServer.kt")"
if [ "$(cat "$CACHE/server/stamp" 2>/dev/null)" != "$server_stamp" ] || [ ! -f "$server_jar" ]; then
  echo "ktcheck: building the compile server (once per kotlin version)" >&2
  "${PY[@]}" run "$SOCK" stop "" >/dev/null 2>&1 || true
  kotlinc -cp "$KLIB/kotlin-compiler.jar" -jvm-target 17 -d "$server_jar" "$HERE/KtServer.kt" 2>&1 | grep -v -e jansi -e '^info:' >&2 || true
  [ -f "$server_jar" ] || { echo "ktcheck: compile server build failed" >&2; exit 2; }
  printf '%s' "$server_stamp" > "$CACHE/server/stamp"
fi

$prepare && exit 0

# Stub R class from res/ (regenerated when anything under res/ changed).
gen="$CACHE/gen/$(printf '%s' "$app" | cksum | cut -d' ' -f1)"
mkdir -p "$gen"
r_kt="$gen/R.kt"
if [ ! -f "$r_kt" ] || [ -n "$(find "$main/res" -newer "$r_kt" -print -quit 2>/dev/null)" ] || [ "$HERE/ktcheck.py" -nt "$r_kt" ]; then
  "${PY[@]}" rclass "$main/res" "$namespace" "$r_kt"
fi

mapfile -t sources < <(find "$main/java" "$main/kotlin" -name '*.kt' 2>/dev/null | sort)
[ ${#sources[@]} -gt 0 ] || { echo "ktcheck: no .kt files under $main/java or $main/kotlin" >&2; exit 2; }
java_roots=()
for d in "$main/java" "$main/kotlin"; do
  [ -n "$(find "$d" -name '*.java' -print -quit 2>/dev/null)" ] && java_roots+=("-Xjava-source-roots=$d")
done

out="$CACHE/out/$(printf '%s' "$app" | cksum | cut -d' ' -f1)"
args=(-no-stdlib -no-reflect -no-jdk
  -cp "$android_jar:$KLIB/kotlin-stdlib.jar:$deps_cp"
  "${plugin_args[@]}" "${java_roots[@]}"
  -jvm-target "$jvm_target" -module-name app -Xuse-fast-jar-file-system
  -d "$out" "${sources[@]}" "$r_kt")

start=$(date +%s%N)
if $server; then
  set +e
  "${PY[@]}" run "$SOCK" "$mode" "$project" "${args[@]}"
  code=$?
  set -e
  if [ $code -eq 100 ]; then
    echo "ktcheck: starting the compile server (cold start is slow; later checks reuse it)" >&2
    rm -f "$SOCK"
    nohup java -Xmx2g -Xss8m -XX:+UseParallelGC -Dkotlin.home="$KOTLIN_HOME" \
      -cp "$server_jar:$KLIB/kotlin-compiler.jar:$KLIB/kotlin-stdlib.jar" KtServerKt "$SOCK" \
      >"$CACHE/server/log" 2>&1 </dev/null &
    disown
    for _ in $(seq 300); do [ -S "$SOCK" ] && break; sleep 0.1; done
    set +e
    "${PY[@]}" run "$SOCK" "$mode" "$project" "${args[@]}"
    code=$?
    set -e
    [ $code -eq 100 ] && { echo "ktcheck: compile server did not start; see $CACHE/server/log" >&2; exit 2; }
  fi
else
  set +e
  if [ "$mode" = full ]; then
    kotlinc "${args[@]}" 2>&1 | grep -v -e jansi -e '^info:' | sed "s|$project/||g"
  else
    java -Xmx2g -Xss8m -XX:+UseParallelGC -Dkotlin.home="$KOTLIN_HOME" \
      -cp "$server_jar:$KLIB/kotlin-compiler.jar:$KLIB/kotlin-stdlib.jar" \
      KtServerKt --once "${args[@]}" 2>&1 | sed "s|$project/||g"
  fi
  code=${PIPESTATUS[0]}
  set -e
fi
ms=$(( ($(date +%s%N) - start) / 1000000 ))
if [ $code -eq 0 ]; then
  echo "ktcheck: OK, ${#sources[@]} files ($mode, ${ms} ms)" >&2
else
  echo "ktcheck: FAILED, ${#sources[@]} files ($mode, ${ms} ms)" >&2
fi
exit $code
