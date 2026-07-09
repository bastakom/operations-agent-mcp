export function getPreviousWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;

  const thisMonday = new Date(now);
  thisMonday.setHours(0, 0, 0, 0);
  thisMonday.setDate(now.getDate() - daysSinceMonday);

  const previousMonday = new Date(thisMonday);
  previousMonday.setDate(thisMonday.getDate() - 7);

  const previousSunday = new Date(previousMonday);
  previousSunday.setDate(previousMonday.getDate() + 6);

  return {
    fromDate: previousMonday.toISOString().slice(0, 10),
    toDate: previousSunday.toISOString().slice(0, 10),
  };
}
