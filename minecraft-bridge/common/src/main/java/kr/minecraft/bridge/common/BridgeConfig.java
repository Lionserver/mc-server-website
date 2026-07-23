package kr.minecraft.bridge.common;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

public record BridgeConfig(
        String apiBaseUrl,
        String serverId,
        String sharedSecret,
        String verificationToken,
        int telemetryIntervalSeconds,
        boolean exposeVerificationToken,
        String publicHost,
        int publicPort
) {
    public static BridgeConfig load(Path path, int defaultPort) throws IOException {
        Files.createDirectories(path.getParent());
        if (Files.notExists(path)) {
            Properties defaults = new Properties();
            defaults.setProperty("apiBaseUrl", "http://127.0.0.1:3000/api/bridge");
            defaults.setProperty("serverId", "replace-from-provision-api");
            defaults.setProperty("sharedSecret", "replace-from-provision-api");
            defaults.setProperty("verificationToken", "replace-from-provision-api");
            defaults.setProperty("telemetryIntervalSeconds", "30");
            defaults.setProperty("exposeVerificationToken", "true");
            defaults.setProperty("publicHost", "127.0.0.1");
            defaults.setProperty("publicPort", Integer.toString(defaultPort));
            try (OutputStream output = Files.newOutputStream(path)) {
                defaults.store(output, "Minecraft.kr bridge configuration");
            }
        }

        Properties properties = new Properties();
        try (InputStream input = Files.newInputStream(path)) {
            properties.load(input);
        }
        return new BridgeConfig(
                stripSlash(properties.getProperty("apiBaseUrl", "http://127.0.0.1:3000/api/bridge")),
                properties.getProperty("serverId", "").trim(),
                properties.getProperty("sharedSecret", "").trim(),
                properties.getProperty("verificationToken", "").trim(),
                Math.max(10, Integer.parseInt(properties.getProperty("telemetryIntervalSeconds", "30"))),
                Boolean.parseBoolean(properties.getProperty("exposeVerificationToken", "true")),
                properties.getProperty("publicHost", "127.0.0.1").trim(),
                Integer.parseInt(properties.getProperty("publicPort", Integer.toString(defaultPort)))
        );
    }

    public boolean configured() {
        return !serverId.isBlank() && !sharedSecret.isBlank()
                && !serverId.startsWith("replace-") && !sharedSecret.startsWith("replace-");
    }

    public String marker() {
        return "[MKR-VERIFY:" + verificationToken + "]";
    }

    private static String stripSlash(String value) {
        String trimmed = value.trim();
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }
}
