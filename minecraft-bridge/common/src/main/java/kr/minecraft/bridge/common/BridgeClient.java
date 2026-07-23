package kr.minecraft.bridge.common;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

public final class BridgeClient {
    private final BridgeConfig config;
    private final HttpClient httpClient;

    public BridgeClient(BridgeConfig config) {
        this.config = config;
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    public CompletableFuture<HttpResponse<String>> sendTelemetry(TelemetrySnapshot snapshot) {
        return post("/telemetry", snapshot.toJson());
    }

    public CompletableFuture<HttpResponse<String>> requestVerification() {
        return post("/verify", "{\"verificationToken\":" + Json.quote(config.verificationToken()) + "}");
    }

    private CompletableFuture<HttpResponse<String>> post(String path, String body) {
        if (!config.configured()) {
            return CompletableFuture.failedFuture(new IllegalStateException("bridge config is not provisioned"));
        }
        long timestamp = Instant.now().getEpochSecond();
        String nonce = UUID.randomUUID().toString();
        String canonical = timestamp + "\n" + nonce + "\nPOST\n/api/bridge" + path + "\n" + sha256(body);
        String signature = hmac(config.sharedSecret(), canonical);
        HttpRequest request = HttpRequest.newBuilder(URI.create(config.apiBaseUrl() + path))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json")
                .header("X-MKR-Server-Id", config.serverId())
                .header("X-MKR-Timestamp", Long.toString(timestamp))
                .header("X-MKR-Nonce", nonce)
                .header("X-MKR-Signature", signature)
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();
        return httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    static String hmac(String secret, String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", exception);
        }
    }
}
