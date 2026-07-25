import {
  isAdminJobKey,
  listJobStatuses,
  operationsSnapshot,
  runTrackedAdminJob,
  updateFeatureControl,
  updateOperationalCheck,
  type AdminJobKey,
} from "@/lib/admin-operations";
import { adminErrorResponse, requireAdmin, writeAudit } from "@/lib/admin-security";
import { cleanupExpiredApplicationData } from "@/lib/maintenance";
import { cleanupBroadcastImageCache } from "@/lib/minecraft-stream-cache";
import { collectPublicStatusSnapshots } from "@/lib/public-directory";
import { purgeExpiredServerQuarantines } from "@/lib/server-quarantine";

export async function GET(request: Request) {
  try {
    const { environment } = await requireAdmin(request);
    return Response.json(await operationsSnapshot(environment.DB), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { environment, session } = await requireAdmin(request, { mutating: true, stepUp: true });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (body.type === "control") {
      const control = await updateFeatureControl(environment.DB, session.email, {
        featureKey: body.featureKey,
        mode: body.mode,
        reason: body.reason,
        expiresAt: body.expiresAt,
      });
      return Response.json({ control }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.type === "check") {
      const check = await updateOperationalCheck(environment.DB, session.email, {
        checkKey: body.checkKey,
        status: body.status,
        note: body.note,
        validUntil: body.validUntil,
      });
      return Response.json({ check }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "type은 control 또는 check여야 합니다." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { environment, session } = await requireAdmin(request, { mutating: true, stepUp: true });
    const body = await request.json().catch(() => ({})) as { jobKey?: unknown };
    if (!isAdminJobKey(body.jobKey)) {
      return Response.json({ error: "지원하지 않는 운영 작업입니다." }, {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const jobKey = body.jobKey;
    try {
      const result = await runTrackedAdminJob(environment.DB, jobKey, "manual", () => executeJob(jobKey, environment));
      const job = (await listJobStatuses(environment.DB)).find((item) => item.jobKey === jobKey);
      await writeAudit(environment.DB, session.email, "operations.job.manual_run", "scheduled_job", jobKey, {
        status: result.status,
        durationMs: result.durationMs,
      });
      return Response.json({ job, status: result.status }, {
        status: result.status === "skipped" ? 409 : 200,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      const job = (await listJobStatuses(environment.DB)).find((item) => item.jobKey === jobKey);
      await writeAudit(environment.DB, session.email, "operations.job.manual_failed", "scheduled_job", jobKey, {
        status: "failed",
      }).catch(() => undefined);
      console.error("manual operations job failed", { jobKey, name: error instanceof Error ? error.name : "unknown" });
      return Response.json({
        error: "운영 작업 실행에 실패했습니다. 작업 상태의 오류 내용을 확인해 주세요.",
        job,
        status: "failed",
      }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    return adminErrorResponse(error);
  }
}

type OperationsEnvironment = {
  DB: D1Database;
  MEDIA?: R2Bucket;
};

async function executeJob(jobKey: AdminJobKey, environment: OperationsEnvironment) {
  if (jobKey === "public_status_snapshots") {
    return collectPublicStatusSnapshots(environment.DB);
  }
  if (jobKey === "application_retention_cleanup") {
    return cleanupExpiredApplicationData(environment.DB);
  }
  if (jobKey === "server_quarantine_purge") {
    return purgeExpiredServerQuarantines(environment);
  }
  if (!environment.MEDIA) throw new Error("MEDIA binding is unavailable");
  return cleanupBroadcastImageCache(environment.MEDIA);
}
