import { z } from "zod";

/**
 * Primitives only. An object here would reach a Mongo query as an operator
 * such as $gt or $where (spec section 5.6), so the schema refuses one.
 */
export const urlIntakeSchema = z.object({
  url: z.url(),
});

export type UrlIntakeRequest = z.infer<typeof urlIntakeSchema>;

export interface IntakeResponse {
  torId: string;
  duplicate: boolean;
  state: "queued";
}
