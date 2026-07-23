package kr.minecraft.bridge.common;

import java.util.List;

public record TelemetrySnapshot(
        String platform,
        int totalPlayers,
        int maxPlayers,
        int averagePingMs,
        String software,
        String version,
        String pluginVersion,
        List<BackendSnapshot> backends
) {
    public String toJson() {
        StringBuilder json = new StringBuilder("{")
                .append("\"platform\":").append(Json.quote(platform)).append(',')
                .append("\"totalPlayers\":").append(totalPlayers).append(',')
                .append("\"maxPlayers\":").append(maxPlayers).append(',')
                .append("\"averagePingMs\":").append(averagePingMs).append(',')
                .append("\"software\":").append(Json.quote(software)).append(',')
                .append("\"version\":").append(Json.quote(version)).append(',')
                .append("\"pluginVersion\":").append(Json.quote(pluginVersion)).append(',')
                .append("\"backends\":[");
        for (int index = 0; index < backends.size(); index++) {
            if (index > 0) json.append(',');
            BackendSnapshot backend = backends.get(index);
            json.append('{')
                    .append("\"id\":").append(Json.quote(backend.id())).append(',')
                    .append("\"players\":").append(backend.players()).append(',')
                    .append("\"maxPlayers\":").append(backend.maxPlayers()).append(',')
                    .append("\"online\":").append(backend.online()).append(',')
                    .append("\"software\":").append(Json.quote(backend.software())).append(',')
                    .append("\"version\":").append(Json.quote(backend.version()))
                    .append('}');
        }
        return json.append("]}").toString();
    }
}
