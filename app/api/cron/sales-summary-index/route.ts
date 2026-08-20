import { refreshSalesSummaryIndex } from "../../../../lib/blikk/sales-summary-index";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshSalesSummaryIndex({
      reportYear: new Date().getFullYear(),
      opportunityBatchSize: 20,
      autoResetAfterHours: 7 * 24,
    });

    return Response.json({
      ok: true,
      invokedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error("Sales Summary cron failed:", error);

    return Response.json(
      {
        ok: false,
        invokedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      { status: 500 }
    );
  }
}
