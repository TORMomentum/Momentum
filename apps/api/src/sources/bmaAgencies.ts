// Canonical BMA agency list (FR-A4 Bangkok-only validation, FR-G3 seeded taxonomy).
// Seed pulled from the source API's own MasterOrgGroups dropdown — see docs/DATA-SOURCES.md.
import { readFileSync } from "node:fs";

export interface BmaAgency {
  agency_id: string;
  name_th: string;
  category: "district_office" | "central_bureau" | "state_enterprise";
  source: string;
}

const seedPath = new URL("../data/bma-agencies.json", import.meta.url);

export const bmaAgencies: BmaAgency[] = JSON.parse(readFileSync(seedPath, "utf8")) as BmaAgency[];

/** Thai names carry inconsistent spacing upstream; compare on a collapsed form. */
function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

const byName = new Map(bmaAgencies.map((a) => [normalizeName(a.name_th), a]));
const byId = new Map(bmaAgencies.map((a) => [a.agency_id, a]));

/** Resolve an upstream agency label to a canonical BMA agency, or undefined if it is not one. */
export function resolveBmaAgency(name: string | undefined): BmaAgency | undefined {
  if (!name) return undefined;
  return byName.get(normalizeName(name));
}

export function getBmaAgencyById(agencyId: string): BmaAgency | undefined {
  return byId.get(agencyId);
}

/** FR-A4: records whose issuing agency is not on the canonical list are tagged, never silently kept. */
export function isBmaAgency(name: string | undefined): boolean {
  return resolveBmaAgency(name) !== undefined;
}
