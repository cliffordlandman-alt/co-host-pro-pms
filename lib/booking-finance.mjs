export function bedroomCount(property) {
  if (Number.isInteger(property?.bedrooms) && property.bedrooms >= 0) return Math.max(1, property.bedrooms);
  for (const label of [property?.bedroomType, property?.name]) {
    if (/\bstudio\b/i.test(label || '')) return 1;
    const match = (label || '').match(/\b(\d+)\s*[- ]?\s*(?:bedrooms?|beds?|br)\b/i);
    if (match) return Math.max(1, Number(match[1]));
  }
  return null;
}
export function bookingFinance({ total, managementPercent, cleaningFee = 0, nights, rooms, dubai, vatRate = dubai ? 5 : 0, tourismRate = 10, tourismEnabled = dubai, channelPercent = 0 }) {
  const cents = (v, label) => {
    if (!/^\d+(\.\d{1,2})?$/.test(String(v))) throw new Error(`Enter a valid ${label} with up to two decimal places`);
    const n = Math.round(Number(v) * 100);
    if (!Number.isSafeInteger(n) || n > 9999999999) throw new Error(`${label} is too large`);
    return n;
  };
  const totalCents = cents(total, 'booking total');
  const percent = cents(managementPercent, 'management percentage');
  const channel = cents(channelPercent, 'channel percentage');
  const vatPercent = cents(vatRate, 'VAT percentage');
  if (channel > 10000 || vatPercent > 10000) throw new Error('Fee percentages must be between 0 and 100');
  if (percent > 10000) throw new Error('Management percentage must be between 0 and 100');
  if (!Number.isInteger(nights) || nights < 1) throw new Error('Checkout must be after check-in');
  if (tourismEnabled && (!Number.isInteger(rooms) || rooms < 1 || rooms > 100)) throw new Error('Enter the number of bedrooms; a studio counts as one');
  const tourism = tourismEnabled ? cents(tourismRate, "tourism rate") * rooms * Math.min(nights, 30) : 0;
  if (totalCents < tourism) throw new Error('Booking total is less than the tourism fee');
  const taxable = totalCents - tourism;
  const net = Math.round(taxable * 10000 / (10000 + vatPercent));
  const vat = taxable - net;
  const company = Math.round(net * percent / 10000);
  const channelAmount = Math.round(net * channel / 10000);
  const cleaning = cents(cleaningFee, 'cleaning deduction');
  if (company + cleaning + channelAmount > net) throw new Error('Management and cleaning deductions exceed net revenue');
  return { grossAmount: totalCents / 100, revenue: net / 100, tourismFee: tourism / 100,
    vatAmount: vat / 100, managementPercent: percent / 100, managementAmount: company / 100,
    ownerAmount: (net - company - cleaning - channelAmount) / 100, channelPercent: channel / 100, channelAmount: channelAmount / 100, tourismRate: Number(tourismRate), tourismRooms: tourismEnabled ? rooms : 0,
    tourismNights: tourismEnabled ? Math.min(nights, 30) : 0, vatRate: vatPercent / 100, financeMode: 'inclusive-v1' };
}
