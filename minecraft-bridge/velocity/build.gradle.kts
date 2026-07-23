plugins { java }

dependencies {
    implementation(project(":common"))
    compileOnly("com.velocitypowered:velocity-api:3.5.0-SNAPSHOT")
    annotationProcessor("com.velocitypowered:velocity-api:3.5.0-SNAPSHOT")
}

tasks.jar {
    dependsOn(":common:jar")
    archiveBaseName.set("minecraft-kr-velocity-bridge")
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from({ configurations.runtimeClasspath.get().filter { it.isDirectory }.map { it } })
    from({ configurations.runtimeClasspath.get().filter { it.isFile }.map { zipTree(it) } })
}
