plugins { java }

dependencies {
    implementation(project(":common"))
    compileOnly("io.papermc.paper:paper-api:1.21.11-R0.1-SNAPSHOT")
}

tasks.jar {
    dependsOn(":common:jar")
    archiveBaseName.set("minecraft-kr-paper-bridge")
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from({ configurations.runtimeClasspath.get().filter { it.isDirectory }.map { it } })
    from({ configurations.runtimeClasspath.get().filter { it.isFile }.map { zipTree(it) } })
}
