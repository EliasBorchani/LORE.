plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(21)

    jvm()
    js {
        nodejs()
        browser()
    }
    iosArm64()
    iosSimulatorArm64()

    sourceSets {
        commonMain.dependencies {
            implementation(project(":core"))
            implementation(libs.kotlinx.serialization.json)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

/**
 * Embeds every `test-references/<case>/` folder into generated Kotlin, so the same tests run on JVM, JS and iOS without
 * reading files (each platform reads files differently, and the simulator and browser cannot be relied on).
 */
val generateGoldenCases by tasks.registering {
    val goldenDir = rootProject.layout.projectDirectory.dir("../test-references").asFile
    val outputDir = layout.buildDirectory.dir("generated/golden/kotlin")
    inputs.dir(goldenDir).withPathSensitivity(PathSensitivity.RELATIVE)
    outputs.dir(outputDir)
    doLast {
        // The JVM limits one string constant to 64 KB: long files are split into chunks joined at runtime.
        fun literal(text: String) = text.chunked(16_000).joinToString(",\n            ") { chunk ->
            "\"" + chunk
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("$", "\\$")
                .replace("\r", "\\r")
                .replace("\n", "\\n")
                .replace("\t", "\\t") + "\""
        }
        val cases = goldenDir.listFiles { f -> f.isDirectory && File(f, "expected.json").exists() }!!.sortedBy { it.name }
        val body = cases.joinToString(",\n") { dir ->
            fun file(name: String) = literal(File(dir, name).readText())
            """
            |        GoldenCase(
            |            name = "${dir.name}",
            |            catalog = join(${file("catalog.json")}),
            |            character = join(${file("character.json")}),
            |            expected = join(${file("expected.json")}),
            |        )""".trimMargin()
        }
        val out = outputDir.get().asFile.resolve("dndtools/golden/GoldenCases.kt")
        out.parentFile.mkdirs()
        out.writeText(
            """
            |// Generated from test-references/ by :golden-runner:generateGoldenCases. Do not edit.
            |package dndtools.golden
            |
            |internal object GoldenCases {
            |    val all: List<GoldenCase> = listOf(
            |$body,
            |    )
            |
            |    private fun join(vararg parts: String) = parts.joinToString("")
            |}
            |""".trimMargin()
        )
    }
}

kotlin.sourceSets.commonTest {
    kotlin.srcDir(generateGoldenCases)
}
