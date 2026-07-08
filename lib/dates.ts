export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function previousWeekRange(referenceDate = new Date()) {
  const d = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  const day = d.getUTCDay() || 7;
  const thisMonday = new Date(d);
  thisMonday.setUTCDate(d.getUTCDate() - day + 1);
  const previousMonday = new Date(thisMonday);
  previousMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  const previousSunday = new Date(previousMonday);
  previousSunday.setUTCDate(previousMonday.getUTCDate() + 6);
  return { from: toDateOnly(previousMonday), to: toDateOnly(previousSunday) };
}

export function validateDateRange(from?: string, to?: string) {
  if (!from || !to) return previousWeekRange();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("Dates must use YYYY-MM-DD format.");
  }
  return { from, to };
}
