/**
 * The sources this system collects from (TOR-87, spec 2026-11-24-source-health §1), in the order the admin
 * page lists them. Removing a source is removing its row here; its health document is then ignored.
 */
export interface SourceDefinition {
  id: string;
  /** Thai, as the admin page and the alert email show it (NFR-F7). */
  name: string;
  /** Automatic sources run on their own and are alerted on; manual ones are run by hand and never stale. */
  kind: "automatic" | "manual";
  /** What the source has given us: TOR records of `system`, or the records whose stages were read. */
  records: { system: string; measure: "tors" | "stages" };
}

export const STAGES_SOURCE_ID = "national-egp-stages";
export const NATIONAL_EGP_IMPORT_ID = "national-egp-import";
export const BMA_EGP_IMPORT_ID = "bma-egp-import";

export const SOURCES: readonly SourceDefinition[] = [
  { id: STAGES_SOURCE_ID, name: "e-GP — ขั้นตอนโครงการ", kind: "automatic", records: { system: "national-egp", measure: "stages" } },
  { id: NATIONAL_EGP_IMPORT_ID, name: "e-GP — นำเข้า TOR", kind: "manual", records: { system: "national-egp", measure: "tors" } },
  { id: BMA_EGP_IMPORT_ID, name: "e-GP กรุงเทพมหานคร — นำเข้า TOR", kind: "manual", records: { system: "bma-egp", measure: "tors" } },
];
