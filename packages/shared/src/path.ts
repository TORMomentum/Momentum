/**
 * The company path (TOR-224): what a vendor who wants to grow into a field is missing, read from the TORs
 * already collected in that field. A statement about the corpus, never a rule about what a TOR must ask.
 */
export interface PathRequirement {
  kind: "certification" | "registration";
  /** A listed certification id (packages/seeds CERTIFICATIONS) or a กรมบัญชีกลาง branch id (CGD_BRANCHES). */
  id: string;
  th: string;
  /** How many of the analysed TORs in this field ask for it. */
  asked: number;
  /** True or false once the vendor has stated what they hold; null while they have not, so "not told" is never "missing". */
  holds: boolean | null;
}

/** One category of the field and how the announced wins in it are spread (TOR-284); the same figures as the dashboard's panel. */
export interface PathCategorySpread {
  category: string;
  /** Awarded projects with a named winner. */
  awarded: number;
  /** Different winners among them. */
  winners: number;
  /** Share of those projects the most frequent winners took, 0 to 1. */
  topShare: number;
}

export interface FieldPath {
  target: { id: string; th: string };
  /** The TORs the figures come from: published, public, with the fields read well enough to count. */
  sample: number;
  /** Most-asked first; only what at least one TOR asks. */
  requirements: PathRequirement[];
  /** Budgets of the sampled TORs that state one; null when none does. */
  budget: { n: number; medianThb: number } | null;
  /** The largest value among the vendor's own past projects, null when they stated none with a value. */
  yourLargestProjectThb: number | null;
  /**
   * TOR-284: the TOR categories this field's kinds of work fall in, with how the announced wins are spread in each.
   * `comparable` holds those with enough awarded projects, widest spread (lowest share) first; `notComparable` counts
   * the rest. Counts and a share only: it does not say a category is easy to enter.
   */
  winnerSpread: {
    topWinners: number;
    minAwarded: number;
    comparable: PathCategorySpread[];
    notComparable: number;
    /** When the latest winner announcement among the field's categories was read (FR-E-6); null when none was. */
    lastAwardAt: string | null;
  };
}
