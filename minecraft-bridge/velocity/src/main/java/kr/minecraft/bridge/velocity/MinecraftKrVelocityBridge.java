package kr.minecraft.bridge.velocity;

import com.google.inject.Inject;
import com.velocitypowered.api.command.SimpleCommand;
import com.velocitypowered.api.event.PostOrder;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyPingEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.annotation.DataDirectory;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import kr.minecraft.bridge.common.BackendSnapshot;
import kr.minecraft.bridge.common.BridgeClient;
import kr.minecraft.bridge.common.BridgeConfig;
import kr.minecraft.bridge.common.TelemetrySnapshot;
import net.kyori.adventure.text.Component;
import org.slf4j.Logger;

import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@Plugin(id = "minecraftkrbridge", name = "Minecraft.kr Bridge", version = "1.0.1", url = "https://minecraft.kr")
public final class MinecraftKrVelocityBridge {
    private final ProxyServer proxy;
    private final Logger logger;
    private final Path dataDirectory;
    private BridgeConfig config;
    private BridgeClient client;
    private final AtomicReference<String> lastResult = new AtomicReference<>("not sent");

    @Inject
    public MinecraftKrVelocityBridge(ProxyServer proxy, Logger logger, @DataDirectory Path dataDirectory) {
        this.proxy = proxy;
        this.logger = logger;
        this.dataDirectory = dataDirectory;
    }

    @Subscribe
    public void onProxyInitialization(ProxyInitializeEvent event) {
        try {
            config = BridgeConfig.load(dataDirectory.resolve("config.properties"), 25565);
            client = new BridgeClient(config);
        } catch (Exception exception) {
            logger.error("Unable to load Minecraft.kr bridge config", exception);
            return;
        }

        var meta = proxy.getCommandManager().metaBuilder("mkrbridge").plugin(this).build();
        proxy.getCommandManager().register(meta, new BridgeCommand());
        proxy.getScheduler().buildTask(this, this::sendTelemetry)
                .delay(Duration.ofSeconds(5))
                .repeat(Duration.ofSeconds(config.telemetryIntervalSeconds()))
                .schedule();
        logger.info("Minecraft.kr Velocity bridge enabled; configured={}", config.configured());
    }

    @Subscribe(order = PostOrder.LAST)
    public void onProxyPing(ProxyPingEvent event) {
        if (config != null && config.exposeVerificationToken() && !config.verificationToken().isBlank()) {
            Component description = event.getPing().getDescriptionComponent();
            event.setPing(event.getPing().asBuilder()
                    .description(description.append(Component.newline()).append(Component.text(config.marker())))
                    .build());
        }
    }

    private void sendTelemetry() {
        List<RegisteredServer> servers = List.copyOf(proxy.getAllServers());
        List<CompletableFuture<BackendSnapshot>> probes = new ArrayList<>();
        for (RegisteredServer server : servers) {
            probes.add(server.ping()
                    .orTimeout(3, TimeUnit.SECONDS)
                    .handle((ping, error) -> new BackendSnapshot(
                            server.getServerInfo().getName(),
                            server.getPlayersConnected().size(),
                            ping == null || ping.getPlayers().isEmpty() ? 0 : ping.getPlayers().get().getMax(),
                            error == null,
                            ping == null ? "unknown" : ping.getVersion().getName(),
                            ping == null ? "unknown" : Integer.toString(ping.getVersion().getProtocol())
                    )));
        }
        CompletableFuture.allOf(probes.toArray(CompletableFuture[]::new)).thenRun(() -> {
            List<BackendSnapshot> backends = probes.stream().map(CompletableFuture::join).toList();
            int averagePing = (int) Math.round(proxy.getAllPlayers().stream()
                    .mapToLong(player -> Math.max(0, player.getPing())).average().orElse(0));
            TelemetrySnapshot snapshot = new TelemetrySnapshot(
                    "velocity",
                    proxy.getPlayerCount(),
                    backends.stream().mapToInt(BackendSnapshot::maxPlayers).sum(),
                    averagePing,
                    "Velocity",
                    proxy.getVersion().getVersion(),
                    "1.0.1",
                    backends
            );
            client.sendTelemetry(snapshot).whenComplete((response, error) -> record("telemetry", response == null ? 0 : response.statusCode(), error));
        });
    }

    private void requestVerification() {
        client.requestVerification().whenComplete((response, error) -> record("verify", response == null ? 0 : response.statusCode(), error));
    }

    private void record(String operation, int status, Throwable error) {
        if (error != null) {
            lastResult.set(operation + " failed: " + error.getMessage());
            logger.warn(lastResult.get());
        } else {
            lastResult.set(operation + " HTTP " + status);
            logger.info(lastResult.get());
        }
    }

    private final class BridgeCommand implements SimpleCommand {
        @Override
        public void execute(Invocation invocation) {
            if (!invocation.source().hasPermission("minecraftkr.bridge.admin")) {
                invocation.source().sendMessage(Component.text("Permission denied."));
                return;
            }
            String action = invocation.arguments().length == 0 ? "status" : invocation.arguments()[0].toLowerCase();
            switch (action) {
                case "status" -> invocation.source().sendMessage(Component.text("Minecraft.kr bridge: configured=" + config.configured() + ", last=" + lastResult.get()));
                case "send" -> {
                    sendTelemetry();
                    invocation.source().sendMessage(Component.text("Telemetry send queued."));
                }
                case "verify" -> {
                    requestVerification();
                    invocation.source().sendMessage(Component.text("Ownership verification queued."));
                }
                default -> invocation.source().sendMessage(Component.text("Usage: /mkrbridge <status|send|verify>"));
            }
        }
    }
}
