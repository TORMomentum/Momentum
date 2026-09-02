import { z } from "zod";

export const urlIntakeSchema = z.object({
  url: z.string().url(),
});

export type UrlIntakeRequest = z.infer<typeof urlIntakeSchema>;
