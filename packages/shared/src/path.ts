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
}
