// Owners Clifford named (2 Oct 2026). Shown on the Owners page as suggestions only: nothing is written until
// someone clicks "Create owner", which uses the normal POST /owners and PATCH /properties/:id paths.
// Properties are matched by name among active properties; a property that already has a different owner is
// never reassigned from here.
export type OwnerSuggestion = {
  key: string; name: string; phone: string; note: string;
  properties: { label: string; expectedCurrency: string }[];
  /** Offer "Airbnb co-host payout goes directly to the owner" for these properties, pre-ticked. */
  cohostOption: boolean;
};

export const SUGGESTED_OWNERS: OwnerSuggestion[] = [
  { key: "dylan-matthysen", name: "Dylan Matthysen", phone: "+27 83 434 9734",
    note: "Gqeberha. Also the Airbnb co-host: the co-host payout Airbnb pays him directly is his owner payout.",
    properties: [{ label: "Green Lawn", expectedCurrency: "ZAR" }, { label: "Grey House", expectedCurrency: "ZAR" }], cohostOption: true },
  { key: "bonnita", name: "Bonnita", phone: "+27 83 981 2633", note: "Clifford's mother.",
    properties: [{ label: "Garden Retreat", expectedCurrency: "ZAR" }], cohostOption: false },
];

/** Last 9 digits, so +27 83 981 2633 and 083 981 2633 compare equal. */
export function phoneKey(phone: string | null | undefined) {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : null;
}
