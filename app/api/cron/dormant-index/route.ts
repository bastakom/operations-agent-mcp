import { refreshDormantCustomerIndex } from "../../../../lib/blikk/dormant-customers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshDormantCustomerIndex({
      years: 3,
      batchSize: 30,
      autoResetAfterHours: 7 * 24,
    });

    return Response.json({
      ok: true,
      invokedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error("Dormant customer cron failed:", error);
    return Response.json(
      {
        ok: false,
        invokedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
