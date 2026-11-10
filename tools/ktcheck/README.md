# ktcheck

Type-checks an Android Kotlin app on the phone (smash), without the Android SDK or Gradle, so
Kotlin edits made in Termux are checked before a build elsewhere.

    ktcheck smash               # check (the frontend only: parse, resolve, type-check, FIR checkers)
    ktcheck --full smash        # also the backend (JVM signature clashes and the like)
    ktcheck --no-server smash   # one-shot kotlinc, nothing left running
    ktcheck --stop              # stop the compile server
    ktcheck --prepare smash     # download and build only (setup.sh runs this)

Messages print as `file:line:col`; it exits 1 on errors.

- **Sources:** `app/src/main/{java,kotlin}/**/*.kt`.
- **Classpath:** `android.jar` for the app's `compileSdk` (downloaded once from Google's SDK repository, sha1-checked), the dependencies `app/build.gradle(.kts)` declares with their transitive compile dependencies (`ktcheck.py deps`: Gradle module metadata when published, else the POM's compile scope; highest requested version wins; classes.jar taken out of AARs), and a stub `R` built from `res/`. kotlinx-serialization's compiler plugin is added when the build uses it.
- **Compile server** (`KtServer.kt`): keeps the Kotlin compiler loaded and JIT-warm between checks, on a Unix socket, and exits after `KTCHECK_IDLE_MIN` (30) idle minutes. It is rebuilt when `KtServer.kt` or the `kotlin` package changes. The first check after it starts takes about 30 s; later ones reuse it.
- **Cache:** `~/.local/share/devenv-tools/ktcheck` (`TOOLS_HOME`): the platform jars, Maven downloads (`m2`, `jars`), classpaths keyed by the dependency list (`cp`), the stub R (`gen`), the server.
- **Needs:** `pkg install kotlin` (setup.sh checks).
