import { PROVINCES, REGIONS, WHOLE_COUNTRY_AREA, WORK_CATEGORIES } from "@tor-radar/seeds";

/**
 * Turning stored ids back into something a vendor recognises.
 *
 * The profile stores taxonomy and province ids, because a label is presentation
 * and an id is the thing matching reads. A vendor who comes back to the screen
 * is owed their own answers in their own words, which is what these produce.
 */

const GROUP_LABELS = new Map(WORK_CATEGORIES.map((group) => [group.id, group.th]));
const LEAF_LABELS = new Map(
  WORK_CATEGORIES.flatMap((group) => group.children.map((leaf) => [leaf.id, leaf.th] as const)),
);
const PROVINCE_LABELS = new Map(PROVINCES.map((province) => [province.id, province.th]));
const REGION_OF = new Map(PROVINCES.map((province) => [province.id, province.region]));
const REGION_LABELS = new Map(REGIONS.map((region) => [region.id, region.th]));
const REGION_SIZES = new Map(
  REGIONS.map((region) => [region.id, PROVINCES.filter((p) => p.region === region.id).length]),
);

/** A whole group is named once, rather than as the eight things it covers. */
export function describeCategories(ids: string[]): string[] {
  const labels: string[] = [];
  for (const id of ids) {
    const group = GROUP_LABELS.get(id);
    if (group) labels.push(`${group} (ทั้งกลุ่ม)`);
  }
  for (const id of ids) {
    const leaf = LEAF_LABELS.get(id);
    if (leaf) labels.push(leaf);
  }
  return labels;
}

/**
 * Fifty provinces listed one by one is not an answer anyone reads, so a region
 * the vendor has taken completely is named as the region.
 */
export function describeAreas(ids: string[]): string[] {
  if (ids.includes(WHOLE_COUNTRY_AREA)) return ["ทั่วประเทศ"];

  const chosen = new Set(ids.filter((id) => PROVINCE_LABELS.has(id)));
  const labels: string[] = [];
  const covered = new Set<string>();

  for (const [regionId, size] of REGION_SIZES) {
    const inRegion = [...chosen].filter((id) => REGION_OF.get(id) === regionId);
    if (inRegion.length === size && size > 0) {
      labels.push(`${REGION_LABELS.get(regionId)} (ทั้งภาค)`);
      for (const id of inRegion) covered.add(id);
    }
  }
  for (const id of ids) {
    if (covered.has(id)) continue;
    const province = PROVINCE_LABELS.get(id);
    if (province) labels.push(province);
  }
  return labels.length > 0 ? labels : ["ยังไม่ได้เลือก"];
}

/**
 * No stated budget is a complete answer, not a missing one.
 *
 * Budget is a scored signal rather than a gate (design §7.3), so "no preference"
 * and "the whole range" match identically. They are NOT stored identically: the
 * full range would claim the vendor said it, and if the ceiling is ever raised
 * a stored one becomes a cap they never chose. So null is kept, and named for
 * what it does.
 */
export function describeBudget(budget: { minThb: number; maxThb: number } | null): string {
  if (!budget) return "ทุกช่วงงบประมาณ";
  const format = (value: number) => new Intl.NumberFormat("th-TH").format(value);
  return `฿${format(budget.minThb)} — ฿${format(budget.maxThb)}`;
}
