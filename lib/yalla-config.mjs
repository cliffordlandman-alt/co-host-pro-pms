// YALLA workbook export: every behaviour behind Raju's 11 answers (9 Oct 2026) is one setting here, so a changed
// answer is a one-line flip. General rule from Raju: where the master workbook and the PMS differ, mirror the master.
// buildWorkbookRows(data, month, overrides) merges overrides over these defaults (the API takes none today).

/** Master workbook lists (Lists & Sources). */
export const MASTER_INCOME_CATEGORIES = ['Airbnb', 'Booking', 'Cleaning', 'Cleaning Profit', 'Cleaning/Viewing', 'Commission', 'DTCM', 'Lock', 'Photography', 'Photos', 'Referral', 'Management Fee', 'Maintenance', 'Other'];
export const MASTER_EXPENSE_CATEGORIES = ['Salary', 'Rent', 'Security Deposit', 'Agent Commission', 'Cleaning', 'DEWA Deposit', 'Cooling Deposit', 'Fuel', 'Noon', 'Car', 'Cleaner', 'Marketing', 'Photography', 'Software', 'DTCM', 'Supplies', 'DEWA', 'Refund'];
export const MASTER_PAYMENT_STATUSES = ['Received', 'Pending', 'Not applicable'];
export const MASTER_TREATMENTS = ['Operating Expense', 'Refundable Deposit', 'Owner Paid (excluded)', 'Pass-through (excluded)'];
/** Lists & Sources property order (A4:A15). PMS properties are listed in this order by workbook name; others follow. */
export const MASTER_PROPERTY_ORDER = ['Sunrise Bay 2106', 'Lofts West 603', 'Modern JVT Villa', 'Villa 7', 'Garden Retreat', '509 Blvd Central', '2 Bd Penthouse JVC - 401', 'Green Lawn House - Port Elizabeth', '2 Bedroom Mount Pleasant', 'Lakeside Spacious 2 Bedroom', '301 A Wing Tower A Arjan', 'Sunrise Bay 1406'];

export const WORKBOOK_DEFAULTS = Object.freeze({
  // Q1-Q3 (1 Sep Lofts booking + 31 Aug refund, Careem 98, DEWA 16 Sep / chiller 17 Sep) are data, not settings:
  // see /workspace/finance/yalla_m2/mac_fixes.

  // Q4. Category: the entry's own "workbook category" (report_category) wins; else an exact master category;
  // else this map (PMS category, lower case → master category). PMS categories with no master equivalent are kept
  // as entered and listed in result.warnings (code "category").
  expenseCategoryMap: { utilities: 'Supplies', utility: 'Supplies', maintenance: 'Supplies', 'agent commission': 'Agent Commission', photos: 'Photography', transport: 'Car' },
  incomeCategoryMap: { photography: 'Photography' },

  // Q5. Management fee row is Received when any of these holds (in order); else Pending.
  //   fee_received_on: the booking's fee_received_on is on/before the month end (fee netted from a payout that left the bank)
  //   owner_payout:    an owner payout for that property's statement of the month is recorded, paid on/before month end
  //   statement_paid:  the owner statement of the month is marked paid
  //   booking_paid:    the booking's payment status is paid
  managementFeeReceivedWhen: ['fee_received_on', 'owner_payout', 'statement_paid', 'booking_paid'],

  // Q6. Booking cleaning-fee income on Income Input. false = left out (the master leaves it out).
  bookingCleaningIncome: false,

  // Q7. An asset deposit the landlord keeps: the kept amount is an expense row with this treatment in that month.
  keptAssetDepositTreatment: 'Operating Expense',

  // Q8. Airbnb Property Report rows (view-only): a cumulative "through 1 <Mon>" row per property dated the 1st (all
  // USD payouts from 1 Jan of the reporting year to the month start), plus the month's rows. Zero rows: 'active' =
  // every Active=Yes property on Lists & Sources gets a row even at 0; 'none' = only non-zero rows.
  propertyReportYtdRows: true,
  propertyReportZeroRows: 'active',

  // Q9. Clifford's salary: AED 15,000 a month (rule 5b), per-month overrides. The export warns when the month's
  // Salary entries differ from it (it never creates salary rows itself).
  salaryMonthly: 15000,
  /** First month the salary check applies (the master's first salary row is June 2026). */
  salaryFrom: '2026-06',
  salaryOverrides: { '2026-08': 12192 },

  // Q10. A property with no workbook name: 'flag' = its rows keep the listing name, it stays off Lists & Sources /
  // Apartment Performance, and result.warnings lists it.
  unmappedProperty: 'flag',

  // Q11. Airbnb payout dates without a year: the year is inferred from the payout's booking check-in(s); a payout
  // where more than one year could fit is flagged in result.warnings (code "payout-year").
  flagAmbiguousPayoutYear: true,

  // ── M3 layout ──
  /** Monthly Summary rows A4:A12: summaryMonths months from summaryFirstMonth (the master's Apr-Dec 2026). If the
   *  reporting month falls outside, the window moves to end on it. */
  summaryFirstMonth: '2026-04',
  summaryMonths: 9,
  /** Properties marked Active? = No on Lists & Sources (workbook names). Everyone else with a workbook name is Yes. */
  inactiveReportNames: [],
  /** Lists & Sources properties that are not in the PMS (mirroring the master's list). They get no Airbnb property
   *  rows and no data from the PMS; result.warnings lists them. */
  extraListProperties: [{ name: 'Villa 7', active: true }],
  bankAccount: 'ADIB 19589605',
  /** Apartment Performance: an extra column J (outside the master's A-H) with owner-paid costs, flagged and excluded. */
  apartmentOwnerPaidColumn: true,
  /** The master's Dashboard H2 is =Checks!B12. The Checks sheet is not exported yet, so H2 holds this text. */
  checksPlaceholder: 'Checks sheet not in this export',
});

export function workbookConfig(overrides = {}) {
  const c = { ...WORKBOOK_DEFAULTS, ...overrides };
  for (const k of ['expenseCategoryMap', 'incomeCategoryMap', 'salaryOverrides']) c[k] = { ...WORKBOOK_DEFAULTS[k], ...(overrides[k] ?? {}) };
  return c;
}
