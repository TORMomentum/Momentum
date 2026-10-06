import { Router } from "express";
import { z } from "zod";
import { TAXONOMY_VERSION, WHOLE_COUNTRY_AREA, WORK_CATEGORIES, WORK_CATEGORY_LEAVES, PROVINCES } from "@tor-radar/seeds";
import type { Config } from "../../core/config.js";
import { UnauthorizedError } from "../../core/errors.js";
import { requireSameOrigin } from "../../core/require-same-origin.js";
import { ProfileRepository } from "./profile.repository.js";

const taxonomyIds = new Set([...WORK_CATEGORIES.map((group) => group.id), ...WORK_CATEGORY_LEAVES.map((leaf) => leaf.id)]);
const areaIds = new Set([WHOLE_COUNTRY_AREA, ...PROVINCES.map((province) => province.id)]);

const profileSchema = z.object({
  categories: z.array(z.string()).max(100).refine((ids) => ids.every((id) => taxonomyIds.has(id)), "มีหมวดหมู่งานที่ไม่อยู่ในรายการ"),
  areas: z.array(z.string()).min(1).max(78).refine((ids) => ids.every((id) => areaIds.has(id)), "มีพื้นที่ให้บริการที่ไม่อยู่ในรายการ"),
  budget: z.object({ minThb: z.number().finite().nonnegative(), maxThb: z.number().finite().nonnegative() }).nullable()
    .refine((value) => value === null || value.minThb <= value.maxThb, "งบประมาณต่ำสุดต้องไม่เกินงบประมาณสูงสุด"),
}).strict();

/**
 * What a caller is given, whether the profile was just written or merely read.
 * Both routes go through here so the two can never drift into different shapes,
 * and so the database's own `_id` — which belongs to the collection, not to the
 * vendor — stays out of the API.
 */
function profileResponse(profile: {
  categories: string[];
  areas: string[];
  budget: { minThb: number; maxThb: number } | null;
  taxonomyVersion: string;
  updatedAt: Date | null;
}) {
  return {
    categories: profile.categories,
    areas: profile.areas,
    budget: profile.budget,
    taxonomyVersion: profile.taxonomyVersion,
    updatedAt: profile.updatedAt ? profile.updatedAt.toISOString() : null,
  };
}

/**
 * A vendor who has not filled anything in has an EMPTY profile, not a missing
 * one: the screen has something to render and matching has something to read
 * that says "no preference stated" rather than "no answer".
 */
function emptyProfile() {
  return { categories: [], areas: [WHOLE_COUNTRY_AREA], budget: null, taxonomyVersion: TAXONOMY_VERSION, updatedAt: null };
}

export function buildProfileRouter(deps: { config: Config; profiles: ProfileRepository }): Router {
  const router = Router();
  router.get("/me/profile", async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const profile = await deps.profiles.findByAccountId(req.auth.account._id.toString());
    res.json(profile ? profileResponse(profile) : emptyProfile());
  });
  router.put("/me/profile", requireSameOrigin(deps.config.appOrigin), async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const input = profileSchema.parse(req.body);
    // Deduplication keeps a replace semantically stable and prevents needless score work.
    const profile = await deps.profiles.replace(req.auth.account._id.toString(), {
      categories: [...new Set(input.categories)], areas: [...new Set(input.areas)], budget: input.budget, taxonomyVersion: TAXONOMY_VERSION,
    });
    res.json(profileResponse(profile));
  });
  return router;
}
