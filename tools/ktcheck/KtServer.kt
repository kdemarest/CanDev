// ktcheck's compile server: keeps the Kotlin compiler loaded and JIT-warm between checks, and
// runs only the frontend (parse, resolve, type-check, FIR checkers incl. kotlinx-serialization's),
// skipping IR translation, lowering and bytecode generation. Built by ktcheck.sh against the
// kotlin-compiler.jar of the installed `kotlin` package.
//
// Protocol (one request per connection, Unix socket): the client sends a mode line ("check" or
// "full"), then one compiler argument per line, then an empty line. The server answers with the
// compiler's messages, then a final line "\u0000EXIT <code>".
// Exits after KTCHECK_IDLE_MIN minutes (default 30) without a request.

import org.jetbrains.kotlin.backend.common.phaser.then
import org.jetbrains.kotlin.cli.common.CLICompiler
import org.jetbrains.kotlin.cli.common.ExitCode
import org.jetbrains.kotlin.cli.common.arguments.K2JVMCompilerArguments
import org.jetbrains.kotlin.cli.common.messages.MessageCollector
import org.jetbrains.kotlin.cli.common.messages.MessageRenderer
import org.jetbrains.kotlin.cli.jvm.K2JVMCompiler
import org.jetbrains.kotlin.cli.pipeline.AbstractCliPipeline
import org.jetbrains.kotlin.cli.pipeline.ArgumentsPipelineArtifact
import org.jetbrains.kotlin.cli.pipeline.PipelineContext
import org.jetbrains.kotlin.cli.pipeline.jvm.JvmConfigurationPipelinePhase
import org.jetbrains.kotlin.cli.pipeline.jvm.JvmFrontendPipelinePhase
import org.jetbrains.kotlin.config.Services
import org.jetbrains.kotlin.config.phaser.CompilerPhase
import org.jetbrains.kotlin.metadata.deserialization.BinaryVersion
import org.jetbrains.kotlin.metadata.deserialization.MetadataVersion
import org.jetbrains.kotlin.platform.TargetPlatform
import org.jetbrains.kotlin.platform.jvm.JvmPlatforms
import org.jetbrains.kotlin.util.PerformanceManager
import java.io.ByteArrayOutputStream
import java.io.PrintStream
import java.net.StandardProtocolFamily
import java.net.UnixDomainSocketAddress
import java.nio.channels.Channels
import java.nio.channels.ServerSocketChannel
import java.nio.file.Files
import java.nio.file.Path
import kotlin.concurrent.thread
import kotlin.system.exitProcess

class FrontendOnlyPipeline(override val defaultPerformanceManager: PerformanceManager) :
    AbstractCliPipeline<K2JVMCompilerArguments>() {
    override fun createCompoundPhase(
        arguments: K2JVMCompilerArguments
    ): CompilerPhase<PipelineContext, ArgumentsPipelineArtifact<K2JVMCompilerArguments>, *> =
        JvmConfigurationPipelinePhase then JvmFrontendPipelinePhase
}

class CheckCompiler : CLICompiler<K2JVMCompilerArguments>() {
    override val platform: TargetPlatform get() = JvmPlatforms.defaultJvmPlatform
    override fun createMetadataVersion(versionArray: IntArray): BinaryVersion = MetadataVersion(*versionArray)
    override fun createArguments() = K2JVMCompilerArguments()
    override fun executableScriptFileName() = "kotlinc-jvm"
    override fun doExecutePhased(
        arguments: K2JVMCompilerArguments,
        services: Services,
        basicMessageCollector: MessageCollector
    ): ExitCode = FrontendOnlyPipeline(defaultPerformanceManager).execute(arguments, services, basicMessageCollector)
}

fun compile(mode: String, args: List<String>): Pair<String, Int> {
    val buf = ByteArrayOutputStream()
    val out = PrintStream(buf, true, "UTF-8")
    val code = try {
        val compiler = if (mode == "full") K2JVMCompiler() else CheckCompiler()
        compiler.exec(out, MessageRenderer.PLAIN_FULL_PATHS, *args.toTypedArray()).code
    } catch (t: Throwable) {
        t.printStackTrace(out)
        3
    }
    out.flush()
    return buf.toString("UTF-8") to code
}

fun main(argv: Array<String>) {
    if (argv.firstOrNull() == "--once") {  // one-shot frontend-only check, no server
        val code = CheckCompiler().exec(System.out, MessageRenderer.PLAIN_FULL_PATHS, *argv.drop(1).toTypedArray()).code
        exitProcess(code)
    }
    val socket = Path.of(argv[0])
    val idleMs = (System.getenv("KTCHECK_IDLE_MIN")?.toLongOrNull() ?: 30L) * 60_000L
    // Keep the compiler's application environment (jar indexes, etc.) between requests.
    System.setProperty("kotlin.environment.keepalive", "true")
    System.setProperty("idea.io.use.nio2", "true")
    Files.deleteIfExists(socket)
    val server = ServerSocketChannel.open(StandardProtocolFamily.UNIX)
    server.bind(UnixDomainSocketAddress.of(socket))
    val last = java.util.concurrent.atomic.AtomicLong(System.currentTimeMillis())
    thread(isDaemon = true) {
        while (true) {
            Thread.sleep(30_000)
            if (System.currentTimeMillis() - last.get() > idleMs) {
                Files.deleteIfExists(socket)
                exitProcess(0)
            }
        }
    }
    val lock = Any()
    while (true) {
        val ch = server.accept()
        thread {
            ch.use {
                val reader = Channels.newInputStream(ch).bufferedReader(Charsets.UTF_8)
                val writer = Channels.newOutputStream(ch).bufferedWriter(Charsets.UTF_8)
                val mode = reader.readLine() ?: return@thread
                if (mode == "stop") {
                    Files.deleteIfExists(socket)
                    exitProcess(0)
                }
                val args = generateSequence { reader.readLine() }.takeWhile { it.isNotEmpty() }.toList()
                val (text, code) = synchronized(lock) {
                    last.set(System.currentTimeMillis())
                    compile(mode, args).also { last.set(System.currentTimeMillis()) }
                }
                writer.write(text)
                writer.write("\u0000EXIT $code\n")
                writer.flush()
            }
        }
    }
}
