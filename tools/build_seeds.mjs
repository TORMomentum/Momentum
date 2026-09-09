#!/usr/bin/env node
// Regenerate the procurement taxonomy seed from the BMA eGP source API.
//
//   node tools/build_seeds.mjs
//
// The source system publishes its own taxonomies as dropdown reference data, so the seed is
// authoritative rather than hand-typed — and every code here is one the API accepts as a filter.
// Re-run this when the upstream taxonomy changes; do not edit the generated JSON by hand.
// See docs/DATA-SOURCES.md.

import { writeFileSync } from "node:fs";

const API_BASE = process.env.BMA_EGP_API_BASE ?? "https://egp2.bangkok.go.th/appapi/api";
const OUT = new URL("../apps/api/src/data/procurement-categories.json", import.meta.url);

/** The three upstream dropdowns worth seeding, and what each one means to us. */
const TAXONOMIES = [
  {
    dropdown: "MasterGoodsIds",
    taxonomy: "goods_category",
    note: "What is being procured — the taxonomy vendor skill tags map onto",
  },
  {
    dropdown: "MasterTypeIds",
    taxonomy: "procurement_type",
    note: "How the work is contracted (construction, hire, consulting, design)",
  },
  {
    dropdown: "MasterProjectCategories",
    taxonomy: "policy_area",
    note: "BMA's own policy grouping for the project",
  },
];

/**
 * Goods codes are blocked by leading digit; the upstream exposes no group label of its own,
 * so name the blocks here rather than leaving bare digits in the seed.
 */
const GOODS_GROUPS = {
  "1": "durable_goods",
  "2": "land",
  "3": "construction",
  "4": "service_contract",
  "5": "rental",
  "6": "consulting",
  "7": "design_and_supervision",
  "9": "unspecified",
};

async function fetchDropdowns(names) {
  const url = `${API_BASE}/Utilities/dropdown?names=${names.join(",")}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`upstream returned HTTP ${res.status}`);
  const body = await res.json();
  return new Map((body.dropdowns ?? []).map((d) => [d.name, d.items ?? []]));
}

const dropdowns = await fetchDropdowns(TAXONOMIES.map((t) => t.dropdown));

const records = [];
for (const { dropdown, taxonomy } of TAXONOMIES) {
  const items = dropdowns.get(dropdown) ?? [];
  if (items.length === 0) throw new Error(`${dropdown} came back empty — refusing to write a seed`);
  for (const item of items) {
    const code = String(item.code ?? "").trim();
    records.push({
      category_id: item.id,
      taxonomy,
      code,
      name_th: item.value,
      ...(taxonomy === "goods_category"
        ? { group: GOODS_GROUPS[code.slice(0, 1)] ?? "unspecified" }
        : {}),
      source: `${dropdown} (egp2.bangkok.go.th)`,
    });
  }
}

records.sort((a, b) => a.taxonomy.localeCompare(b.taxonomy) || a.code.localeCompare(b.code));
writeFileSync(OUT, `${JSON.stringify(records, null, 2)}\n`, "utf8");

const counts = records.reduce((acc, r) => ({ ...acc, [r.taxonomy]: (acc[r.taxonomy] ?? 0) + 1 }), {});
console.log(`wrote ${records.length} records to ${OUT.pathname}`);
for (const [taxonomy, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(3)}  ${taxonomy}`);
