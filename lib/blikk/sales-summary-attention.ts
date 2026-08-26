import type {
  SalesSummaryCustomer,
} from "./sales-summary-index";

export type SalesAttentionAction = {
  priority: number;
  code:
    | "OVERDUE_OPPORTUNITY"
    | "OPPORTUNITY_WITHOUT_VALUE"
    | "OPPORTUNITY_WITHOUT_PROBABILITY"
    | "OPPORTUNITY_WITHOUT_CLOSING_DATE"
    | "STALE_ACTIVE_OFFER"
    | "PIPELINE_WITHOUT_MEETING_SIGNAL"
    | "CUSTOMER_WITHOUT_RESPONSIBLE"
    | "DECLINING_INVOICED_RUN_RATE";
  customerId: string;
  customerName: string;
  responsibleId: string | null;
  responsibleName: string | null;
  entityType: "customer" | "opportunity" | "offer";
  entityId: string;
  title: string;
  reason: string;
  recommendedAction: string;
  sourceFacts: Record<string, unknown>;
};

export type SalesAttentionResult = {
  generatedAt: string;
  staleOfferDays: number;
  agencyActions: SalesAttentionAction[];
  byResponsible: Array<{
    responsibleId: string | null;
    responsibleName: string;
    actionCount: number;
    topActions: SalesAttentionAction[];
  }>;
  customerSignals: Array<{
    customerId: string;
    customerName: string;
    potentialSignals: string[];
    riskSignals: string[];
    actionCount: number;
  }>;
  limitations: string[];
};

function dateOnly(value: string | null) {
  const result = value?.slice(0, 10) ?? "";

  return /^\d{4}-\d{2}-\d{2}$/.test(result)
    ? result
    : null;
}

function daysBetween(
  olderDate: string,
  newerDate: string
) {
  const older = new Date(`${olderDate}T00:00:00Z`);
  const newer = new Date(`${newerDate}T00:00:00Z`);

  return Math.max(
    0,
    Math.floor(
      (newer.getTime() - older.getTime()) /
        86_400_000
    )
  );
}

function daysInYear(year: number) {
  return new Date(Date.UTC(year, 1, 29)).getUTCDate() ===
    29
    ? 366
    : 365;
}

function dayOfYear(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );

  return (
    Math.floor((current - start) / 86_400_000) + 1
  );
}

function runRateProjection(
  invoiced: number,
  reportYear: number,
  generatedAt: Date
) {
  if (invoiced <= 0) {
    return 0;
  }

  if (generatedAt.getUTCFullYear() < reportYear) {
    return 0;
  }

  if (generatedAt.getUTCFullYear() > reportYear) {
    return invoiced;
  }

  return (
    invoiced /
    Math.max(dayOfYear(generatedAt), 1)
  ) * daysInYear(reportYear);
}

function responsible(customer: SalesSummaryCustomer) {
  return {
    responsibleId: customer.responsible?.id ?? null,
    responsibleName:
      customer.responsible?.name ?? null,
  };
}

function action(
  customer: SalesSummaryCustomer,
  input: Omit<
    SalesAttentionAction,
    | "customerId"
    | "customerName"
    | "responsibleId"
    | "responsibleName"
  >
): SalesAttentionAction {
  return {
    customerId: customer.customerId,
    customerName: customer.customerName,
    ...responsible(customer),
    ...input,
  };
}

function buildCustomerActions(
  customer: SalesSummaryCustomer,
  options: {
    today: string;
    reportYear: number;
    generatedAt: Date;
    staleOfferDays: number;
  }
) {
  const actions: SalesAttentionAction[] = [];

  if (!customer.responsible?.name) {
    actions.push(
      action(customer, {
        priority: 100,
        code: "CUSTOMER_WITHOUT_RESPONSIBLE",
        entityType: "customer",
        entityId: customer.customerId,
        title: "Kund saknar ansvarig",
        reason:
          "Ingen ansvarig kunde hämtas från kundkort, affär, projekt eller offert.",
        recommendedAction:
          "Tilldela och verifiera kundansvarig i Blikk.",
        sourceFacts: {
          responsibleSource:
            customer.responsibleSource,
        },
      })
    );
  }

  for (const opportunity of customer.openOpportunities) {
    const closingDate = dateOnly(
      opportunity.estimatedClosingDate
    );

    if (closingDate && closingDate < options.today) {
      actions.push(
        action(customer, {
          priority: 98,
          code: "OVERDUE_OPPORTUNITY",
          entityType: "opportunity",
          entityId: opportunity.id,
          title: opportunity.title,
          reason: `Affären är fortfarande öppen trots beräknat avslut ${closingDate}.`,
          recommendedAction:
            "Uppdatera status, nytt beslutsdatum och nästa säljsteg.",
          sourceFacts: {
            estimatedClosingDate: closingDate,
            status: opportunity.status?.name ?? null,
            turnover: opportunity.turnover,
            probability: opportunity.probability,
          },
        })
      );
    }

    if (
      opportunity.turnover === null ||
      opportunity.turnover <= 0
    ) {
      actions.push(
        action(customer, {
          priority: 96,
          code: "OPPORTUNITY_WITHOUT_VALUE",
          entityType: "opportunity",
          entityId: opportunity.id,
          title: opportunity.title,
          reason:
            "Den öppna affären saknar ett positivt affärsvärde.",
          recommendedAction:
            "Bedöm och registrera affärsvärdet i Blikk.",
          sourceFacts: {
            turnover: opportunity.turnover,
            status: opportunity.status?.name ?? null,
          },
        })
      );
    }

    if (opportunity.probability === null) {
      actions.push(
        action(customer, {
          priority: 92,
          code: "OPPORTUNITY_WITHOUT_PROBABILITY",
          entityType: "opportunity",
          entityId: opportunity.id,
          title: opportunity.title,
          reason:
            "Den öppna affären saknar sannolikhet och kan därför inte viktas korrekt.",
          recommendedAction:
            "Registrera en verifierad sannolikhet i Blikk.",
          sourceFacts: {
            turnover: opportunity.turnover,
            status: opportunity.status?.name ?? null,
          },
        })
      );
    }

    if (!closingDate) {
      actions.push(
        action(customer, {
          priority: 90,
          code: "OPPORTUNITY_WITHOUT_CLOSING_DATE",
          entityType: "opportunity",
          entityId: opportunity.id,
          title: opportunity.title,
          reason:
            "Den öppna affären saknar förväntat beslutsdatum.",
          recommendedAction:
            "Registrera ett realistiskt förväntat beslutsdatum.",
          sourceFacts: {
            turnover: opportunity.turnover,
            probability: opportunity.probability,
            status: opportunity.status?.name ?? null,
          },
        })
      );
    }
  }

  for (const offer of customer.activeOffers) {
    const updatedDate = dateOnly(
      offer.updatedDate ?? offer.createdDate
    );

    if (
      updatedDate &&
      daysBetween(updatedDate, options.today) >=
        options.staleOfferDays
    ) {
      const age = daysBetween(
        updatedDate,
        options.today
      );

      actions.push(
        action(customer, {
          priority: 88,
          code: "STALE_ACTIVE_OFFER",
          entityType: "offer",
          entityId: offer.id,
          title: offer.title,
          reason: `Den aktiva offerten har inte uppdaterats på ${age} dagar.`,
          recommendedAction:
            "Följ upp offerten och uppdatera status eller nästa steg.",
          sourceFacts: {
            offerNumber: offer.offerNumber,
            offerValue: offer.offerValue,
            state: offer.state,
            updatedDate,
            ageDays: age,
          },
        })
      );
    }
  }

  if (
    customer.pipeline > 0 &&
    customer.bookedSalesMeetings === 0
  ) {
    actions.push(
      action(customer, {
        priority: 82,
        code: "PIPELINE_WITHOUT_MEETING_SIGNAL",
        entityType: "customer",
        entityId: customer.customerId,
        title: "Pipeline utan mötessignal",
        reason:
          "Kunden har öppen pipeline men ingen affär med mötesstatus i Blikk.",
        recommendedAction:
          "Verifiera nästa kontakt och boka möte om inget redan finns i extern kalender.",
        sourceFacts: {
          pipeline: customer.pipeline,
          weightedPipeline:
            customer.weightedPipeline,
          openOpportunities:
            customer.openOpportunities.length,
          meetingSignalBasis:
            "Blikk opportunity status only",
        },
      })
    );
  }

  const previousYear = String(
    options.reportYear - 1
  );
  const previousYearInvoiced =
    customer.historicalSales[previousYear] ?? 0;
  const projectedCurrentYear = runRateProjection(
    customer.invoicedCurrentYear,
    options.reportYear,
    options.generatedAt
  );

  if (
    previousYearInvoiced > 0 &&
    projectedCurrentYear < previousYearInvoiced * 0.75
  ) {
    actions.push(
      action(customer, {
        priority: 76,
        code: "DECLINING_INVOICED_RUN_RATE",
        entityType: "customer",
        entityId: customer.customerId,
        title: "Fakturerad run-rate under föregående år",
        reason:
          "Årets enkla faktureringstakt indikerar minst 25 procent lägre helårsnivå än föregående års fakturering.",
        recommendedAction:
          "Granska relation, aktiva projekt och möjliga merförsäljningsaktiviteter.",
        sourceFacts: {
          previousYear,
          previousYearInvoiced,
          currentYearInvoiced:
            customer.invoicedCurrentYear,
          projectedCurrentYear,
          projectionMethod:
            "current invoiced divided by elapsed calendar days, multiplied by days in report year",
        },
      })
    );
  }

  return actions.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.customerName.localeCompare(
        b.customerName,
        "sv"
      )
  );
}

export function buildSalesAttention(
  customers: SalesSummaryCustomer[],
  options: {
    reportYear: number;
    generatedAt?: string;
    staleOfferDays?: number;
    actionsPerResponsible?: number;
  }
): SalesAttentionResult {
  const generatedAt = options.generatedAt
    ? new Date(options.generatedAt)
    : new Date();
  const today = generatedAt.toISOString().slice(0, 10);
  const staleOfferDays = Math.min(
    Math.max(options.staleOfferDays ?? 30, 1),
    3650
  );
  const actionsPerResponsible = Math.min(
    Math.max(options.actionsPerResponsible ?? 5, 1),
    10
  );

  const actions = customers.flatMap((customer) =>
    buildCustomerActions(customer, {
      today,
      reportYear: options.reportYear,
      generatedAt,
      staleOfferDays,
    })
  );
  const groups = new Map<
    string,
    SalesAttentionAction[]
  >();

  for (const item of actions) {
    const key =
      item.responsibleId ??
      item.responsibleName ??
      "unassigned";

    groups.set(key, [
      ...(groups.get(key) ?? []),
      item,
    ]);
  }

  const customerSignals = customers.map((customer) => {
    const customerActions = actions.filter(
      (item) =>
        item.customerId === customer.customerId
    );
    const potentialSignals = [
      customer.pipeline > 0
        ? `Öppen pipeline ${customer.pipeline} SEK.`
        : null,
      customer.acceptedOfferValue > 0
        ? `Accepterat offertvärde ${customer.acceptedOfferValue} SEK, redovisas separat från sålt.`
        : null,
      customer.activeProjects.length > 0
        ? `${customer.activeProjects.length} aktiva projekt.`
        : null,
    ].filter((item): item is string => item !== null);
    const riskSignals = customerActions
      .map((item) => item.reason)
      .slice(0, 5);

    return {
      customerId: customer.customerId,
      customerName: customer.customerName,
      potentialSignals,
      riskSignals,
      actionCount: customerActions.length,
    };
  });

  return {
    generatedAt: generatedAt.toISOString(),
    staleOfferDays,
    agencyActions: actions,
    byResponsible: [...groups.entries()]
      .map(([key, groupActions]) => ({
        responsibleId:
          key === "unassigned"
            ? null
            : groupActions[0]
                ?.responsibleId ?? null,
        responsibleName:
          groupActions[0]?.responsibleName ??
          "Ej tilldelad",
        actionCount: groupActions.length,
        topActions: groupActions.slice(
          0,
          actionsPerResponsible
        ),
      }))
      .sort(
        (a, b) =>
          (b.topActions[0]?.priority ?? 0) -
            (a.topActions[0]?.priority ?? 0) ||
          b.actionCount - a.actionCount
      ),
    customerSignals,
    limitations: [
      "Budgetgap kan inte prioriteras innan en auktoritativ årsbudget är ansluten.",
      "Mötessignalen baseras på affärsstatus i Blikk och verifierar inte extern kalender.",
      "Run-rate är en enkel linjär signal och inte en låst budget eller prognos.",
      "Accepterade offerter redovisas separat och räknas inte automatiskt som sålt men ej fakturerat.",
    ],
  };
}
