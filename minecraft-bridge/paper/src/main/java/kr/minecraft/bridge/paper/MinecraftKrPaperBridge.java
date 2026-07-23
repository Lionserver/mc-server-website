package kr.minecraft.bridge.paper;

import kr.minecraft.bridge.common.BackendSnapshot;
import kr.minecraft.bridge.common.BridgeClient;
import kr.minecraft.bridge.common.BridgeConfig;
import kr.minecraft.bridge.common.TelemetrySnapshot;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServerListPingEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.lang.reflect.Method;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

public final class MinecraftKrPaperBridge extends JavaPlugin implements Listener {
    private BridgeConfig config;
    private BridgeClient client;
    private Object telemetryTask;
    private volatile String lastResult = "not sent";

    @Override
    public void onEnable() {
        try {
            Path path = getDataFolder().toPath().resolve("config.properties");
            config = BridgeConfig.load(path, Bukkit.getPort());
            client = new BridgeClient(config);
        } catch (Exception exception) {
            getLogger().severe("Unable to load bridge config: " + exception.getMessage());
            Bukkit.getPluginManager().disablePlugin(this);
            return;
        }

        Bukkit.getPluginManager().registerEvents(this, this);
        scheduleTelemetry();
        getLogger().info("Minecraft.kr Paper bridge enabled; configured=" + config.configured());
    }

    @Override
    public void onDisable() {
        if (telemetryTask instanceof BukkitTask task) {
            task.cancel();
        } else if (telemetryTask != null) {
            try {
                telemetryTask.getClass().getMethod("cancel").invoke(telemetryTask);
            } catch (ReflectiveOperationException exception) {
                getLogger().warning("Unable to cancel Folia telemetry task: " + exception.getMessage());
            }
        }
    }

    @EventHandler
    public void onServerListPing(ServerListPingEvent event) {
        if (config.exposeVerificationToken() && !config.verificationToken().isBlank()) {
            event.setMotd(event.getMotd() + "\n" + config.marker());
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        String action = args.length == 0 ? "status" : args[0].toLowerCase();
        switch (action) {
            case "status" -> sender.sendMessage("Minecraft.kr bridge: configured=" + config.configured() + ", last=" + lastResult);
            case "send" -> {
                sendTelemetry();
                sender.sendMessage("Telemetry send queued.");
            }
            case "verify" -> {
                requestVerification();
                sender.sendMessage("Ownership verification queued.");
            }
            default -> sender.sendMessage("Usage: /mkrbridge <status|send|verify>");
        }
        return true;
    }

    private void sendTelemetry() {
        int online = Bukkit.getOnlinePlayers().size();
        TelemetrySnapshot snapshot = new TelemetrySnapshot(
                "paper",
                online,
                Bukkit.getMaxPlayers(),
                0,
                Bukkit.getName(),
                Bukkit.getVersion(),
                getDescription().getVersion(),
                List.of(new BackendSnapshot("primary", online, Bukkit.getMaxPlayers(), true, Bukkit.getName(), Bukkit.getVersion()))
        );
        client.sendTelemetry(snapshot).whenComplete((response, error) -> record("telemetry", response == null ? 0 : response.statusCode(), error));
    }

    private void requestVerification() {
        client.requestVerification().whenComplete((response, error) -> record("verify", response == null ? 0 : response.statusCode(), error));
    }

    private void scheduleTelemetry() {
        if (!isFolia()) {
            telemetryTask = Bukkit.getScheduler().runTaskTimerAsynchronously(
                    this,
                    this::sendTelemetry,
                    20L * 5,
                    20L * config.telemetryIntervalSeconds()
            );
            return;
        }
        try {
            Object asyncScheduler = Bukkit.getServer().getClass().getMethod("getAsyncScheduler").invoke(Bukkit.getServer());
            Method runAtFixedRate = asyncScheduler.getClass().getMethod(
                    "runAtFixedRate",
                    org.bukkit.plugin.Plugin.class,
                    Consumer.class,
                    long.class,
                    long.class,
                    TimeUnit.class
            );
            Consumer<Object> task = ignored -> sendTelemetry();
            telemetryTask = runAtFixedRate.invoke(
                    asyncScheduler,
                    this,
                    task,
                    5L,
                    (long) config.telemetryIntervalSeconds(),
                    TimeUnit.SECONDS
            );
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException("Unable to start the Folia async telemetry scheduler", exception);
        }
    }

    private static boolean isFolia() {
        try {
            Class.forName("io.papermc.paper.threadedregions.RegionizedServer");
            return true;
        } catch (ClassNotFoundException ignored) {
            return false;
        }
    }

    private void record(String operation, int status, Throwable error) {
        if (error != null) {
            lastResult = operation + " failed: " + error.getMessage();
            getLogger().warning(lastResult);
        } else {
            lastResult = operation + " HTTP " + status;
            getLogger().info(lastResult);
        }
    }
}
