/**
 * Lays bookings out as continuous bars over a run of consecutive days (a calendar week row, or a timeline).
 * A bar runs from the middle of the check-in day to the middle of the checkout day, so a checkout and the next
 * check-in on the same day share that day without overlapping. Overlapping bars go into separate lanes.
 * Positions are fractions of the row width (0..1).
 */
export type BarItem = { checkIn: string; checkOut: string };
export type Bar<T> = {
  item: T;
  left: number;       // fraction of the row where the bar starts
  width: number;      // fraction of the row the bar covers
  lane: number;       // 0 = top lane
  roundStart: boolean; // the check-in is inside this row (round the left end)
  roundEnd: boolean;   // the checkout is inside this row (round the right end)
  showLabel: boolean;  // name shown once per row: at check-in, or at the start of a row the stay continues into
};

const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;

export function layoutBars<T extends BarItem>(items: T[], days: string[]): { bars: Bar<T>[]; lanes: number } {
  const n = days.length;
  if (!n) return { bars: [], lanes: 0 };
  const first = dayNumber(days[0]), last = first + n - 1;
  // Half-day units: day i spans [2i, 2i+2); its middle is 2i+1.
  const spans = items.flatMap(item => {
    const ci = dayNumber(item.checkIn), co = dayNumber(item.checkOut);
    if (!(co > ci) || co < first || ci > last) return [];
    const roundStart = ci >= first, roundEnd = co <= last;
    const s = roundStart ? 2 * (ci - first) + 1 : 0;
    const e = roundEnd ? 2 * (co - first) + 1 : 2 * n;
    return e > s ? [{ item, s, e, roundStart, roundEnd }] : [];
  }).sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
  const laneEnds: number[] = [];
  const bars = spans.map(sp => {
    let lane = laneEnds.findIndex(end => end <= sp.s);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = sp.e;
    // A continuation shorter than one day (e.g. a checkout morning at the start of a week) shows no label.
    const showLabel = sp.roundStart || sp.e - sp.s >= 2;
    return { item: sp.item, left: sp.s / (2 * n), width: (sp.e - sp.s) / (2 * n), lane, roundStart: sp.roundStart, roundEnd: sp.roundEnd, showLabel };
  });
  return { bars, lanes: laneEnds.length };
}
