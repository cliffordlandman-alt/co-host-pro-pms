const labels: Record<string, string> = {
  SUMMARY: 'Listing description', SPACE: 'Your property', ACCESS: 'Guest access',
  INTERACTION: 'Interaction with guests', NOTES: 'Other details to note',
  HOUSE_RULES: 'Additional house rules', NEIGHBORHOOD_OVERVIEW: 'Neighbourhood', TRANSIT: 'Getting around',
};
export function AirbnbSourceDetails({ snapshot }: { snapshot?: string | null }) {
  if (!snapshot) return null;
  let data: any;
  try { data = JSON.parse(snapshot); } catch { return null; }
  const details = data.descriptions ?? {};
  const source = data.source ?? {};
  const rules = source.houseRules?.houseRulesByType ?? [];
  const check = source.checkInOut ?? {};
  const hour = (value: number | null | undefined) => value == null ? 'Not specified on source' : `${String(value).padStart(2, '0')}:00`;
  return <section className="space-y-4 rounded-xl border border-teal-400/20 p-4">
    <div>
      <h3 className="text-sm font-semibold text-teal-300">Airbnb listing copy</h3>
      <p className="mt-1 text-xs text-white/60">{data.photoCount} original photos · {data.city}, {data.country}</p>
      <p className="mt-2 text-xs text-amber-200">{data.detailCaptured ? 'Source details captured. Final completeness review is pending.' : 'Titles and photos captured. Full descriptions, amenities and rules are still pending.'}</p>
    </div>
    {Object.entries(labels).map(([key, label]) => (details[key] ?? []).filter((v: any) => typeof v.value === 'string' && v.value.length > 0).map((v: any) => <div key={`${key}-${v.language}`}>
      <h4 className="text-xs font-semibold text-white/60">{label}{v.language !== 'en' ? ` (${v.languageName || v.language})` : ''}</h4>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-white/80">{v.value}</p>
    </div>))}
    {source.checkInOut && <div className="text-sm text-white/75 space-y-1">
      <h4 className="text-xs font-semibold text-white/60">Arrival and departure</h4>
      <p>Check-in from {hour(check.checkInTimeStart)}</p>
      {check.checkInTimeEnd != null && <p>Check-in until {hour(check.checkInTimeEnd)}</p>}
      <p>Checkout: {hour(check.checkOutTime)}</p>
    </div>}
    {rules.length > 0 && <div className="text-sm text-white/75 space-y-1">
      <h4 className="text-xs font-semibold text-white/60">House rules</h4>
      {rules.map((rule: any) => <p key={rule.houseRuleType}>{String(rule.houseRuleType).toLowerCase().replaceAll('_',' ')}: {rule.isEnabled === true ? 'Yes' : rule.isEnabled === false ? 'No' : 'Not specified on source'}</p>)}
    </div>}
    <a className="inline-block text-xs text-teal-300 underline" href={data.listingUrl} target="_blank" rel="noopener noreferrer">View original Airbnb listing</a>
  </section>;
}
