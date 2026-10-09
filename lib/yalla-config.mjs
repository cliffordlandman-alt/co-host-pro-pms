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
  // else this map (PMS category, lower case → master category). A row whose category has no master equivalent:
  // 'exclude' = left out of the export (result.excluded) with a warning (code "category") naming its amount
  // (Raju, 9 Oct round 2); 'keep' = exported under the entered category, still warned.
  unmappedCategoryRows: 'exclude',
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
  // USD payouts from 1 Jan of the reporting year to the month start), plus the month's rows. Zero rows: 'flag' =
  // a property gets a row even at 0 when its "Show in report" flag (properties.show_in_report) is on and it is
  // Active=Yes on Lists & Sources; 'none' = only non-zero rows. Non-zero rows always show. Each property row's USD is
  // rounded to the cent and the rounding remainder of a payout goes on its largest row, so the property rows sum
  // exactly to the payouts.
  propertyReportYtdRows: true,
  propertyReportZeroRows: 'flag',

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
  bankAccount: 'ADIB 19589605',
  /** Dashboard J5: 'latest' = the most recent balance entered (the dated latest entry or a month end, whichever is
   *  later), shown with its date like the master ("9 OCT 2026"); 'month_end' = the reporting month's closing balance. */
  bankBalanceShows: 'latest',
  /** Income / Expense Input rows: from the Monthly Summary's first month ('summary') or the reporting month
   *  ('month'), through 'today' (as the master, which already has the October rent row) or the month end
   *  ('month_end'). Generated rows (Airbnb, management fees, maintenance) stop at the reporting month end. */
  inputFrom: 'summary',
  inputThrough: 'today',
  /** Apartment Performance: an extra column J (outside the master's A-H) with owner-paid costs, flagged and excluded. */
  apartmentOwnerPaidColumn: true,
  // ── M5 Forecast sheet (the master's "Cash Forecast"): inputs default to the workbook, as in the master ──
  /** Months forecast (rows), starting the month after the reporting month; closing balances shown after 3, 6, 9. */
  forecastMonths: 9,
  /** Last complete months up to the reporting month end used for the averages (master B7). */
  forecastAverageMonths: 3,
  /** Monthly salary in the forecast (master B12); null = salaryMonthly. */
  forecastSalary: null,
  forecastSalaryNote: 'June, July and September level',
  forecastAirbnbNote: 'Average of Airbnb Monthly Report rows (includes Sea View / Sunrise Bay 2106)',
  /** Forecast opening balance (master B5): 'available' = Dashboard J13, the bank balance less tenant deposits held
   *  (the master since 9 Oct); 'bank' = Dashboard J5. */
  forecastOpening: 'available',
  /** Forecast one-off income (master B18:B19, column D): Income Input rows dated after the reporting month end with
   *  status Pending, Data View Transaction and property in this list (company-level income, no property such as the 3% sale
   *  commission); they land in the month of the first such row. Not part of the averages. [] = none. */
  forecastOneOffProperties: ['Company', 'Various'],
  /** Forecast expected commissions (master B20:B21, own column): Clifford's assumption of future commissions a
   *  month from a start month, separate from the averages and the one-off (master since 9 Oct). monthly 0 = none. */
  forecastExpectedCommissions: { monthly: 15000, from: '2026-11' },
  /** Title prefix of the exported sheets ("<title> - Finance Dashboard"): the master's exact text, in the export only
   *  (Raju, 9 Oct round 3). The app itself stays Co-Host Pro. The API's "workbook" setting (reportTitle) overrides it. */
  reportTitle: 'YallaStay',
  // ── M4 Checks sheet ──
  /** Income checks the master keeps on Checks (row 6) with the amount from Lists & Sources items: income rows of the
   *  property in the month must equal the expected AED amount. */
  incomeChecks: [{ property: 'Villa 7', month: '2026-08', expected: 8000, item: 'Villa 7 income', source: 'User instruction', reference: 'Owner commission', label: 'Villa 7 current month AED', note: 'Review Villa 7 transaction' }],
});

export function workbookConfig(overrides = {}) {
  const c = { ...WORKBOOK_DEFAULTS, ...overrides };
  for (const k of ['expenseCategoryMap', 'incomeCategoryMap', 'salaryOverrides']) c[k] = { ...WORKBOOK_DEFAULTS[k], ...(overrides[k] ?? {}) };
  return c;
}
