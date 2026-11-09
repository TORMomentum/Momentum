import "../test/env.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../core/config.js";
import { responseSchema, systemPrompt } from "./vertex.ai.js";
import { vertexConfig } from "./vertex.factory.js";

const env = process.env;

describe("vertexConfig", () => {
  it("asks for nothing extra by default, so the measured prompt and schema are what is sent", () => {
    const options = vertexConfig(loadConfig(env));
    const ask = { workLocation: options.workLocation, biddingFields: options.biddingFields };
    expect(ask).toEqual({ workLocation: false, biddingFields: false });
    expect(responseSchema(ask)).toBe(responseSchema());
    expect(systemPrompt(ask)).toBe(systemPrompt());
  });

  it("carries both switches into the request the extractor builds", () => {
    const options = vertexConfig(loadConfig({ ...env, EXTRACT_WORK_LOCATION_ENABLED: "true", EXTRACT_BIDDING_FIELDS_ENABLED: "true" }));
    const ask = { workLocation: options.workLocation, biddingFields: options.biddingFields };
    for (const key of ["work_location", "evaluation_method", "evaluation_weights", "required_documents"]) {
      expect(responseSchema(ask).properties).toHaveProperty(key);
      expect(responseSchema(ask).required).toContain(key);
      expect(systemPrompt(ask)).toContain(key);
    }
    // The model, location and credentials still come from the Vertex section.
    expect(options.model).toBe(loadConfig(env).vertex.model);
  });
});
