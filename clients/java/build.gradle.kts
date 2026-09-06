/*
 * `dev.svatah:svatah-sdk` (REQ-SDK-2, LLD §13.8).
 *
 * Generated from the service's OpenAPI description by
 * `node scripts/generate-clients.mjs`, published from the same pipeline as the
 * npm tarballs and versioned with them.
 *
 * No dependencies. `java.net.http` has been in the JDK since 11 and is enough
 * for a loopback client and a `text/event-stream` reader; a client for a local
 * service that pulled in an HTTP library and its transitive tree would have a
 * licence surface larger than its code (REQ-PKG-3). It also means `javac` alone
 * compiles it, which is what `scripts/smoke-clients.mjs` does — no build tool
 * and no network in the smoke path.
 *
 * `Smoke.java` is deliberately outside `src/`: it is the T9.3 smoke script, not
 * part of the published artifact.
 */
plugins {
    `java-library`
    `maven-publish`
}

group = "dev.svatah"
version = "0.1.0"

java {
    // JDK 17, the version REQ-NFR-7 and this phase's environment note name.
    toolchain { languageVersion.set(JavaLanguageVersion.of(17)) }
    withSourcesJar()
    withJavadocJar()
}

repositories { mavenCentral() }

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
            artifactId = "svatah-sdk"
            pom {
                name.set("Svatah SDK")
                description.set(
                    "Typed client for the Svatah local service, generated from its OpenAPI description",
                )
                url.set("https://github.com/a-t-u-l/svatah")
                licenses {
                    license {
                        name.set("Apache License, Version 2.0")
                        url.set("https://www.apache.org/licenses/LICENSE-2.0.txt")
                    }
                }
            }
        }
    }
}
