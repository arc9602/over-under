import { describe, expect, it } from "vitest";
import { optionLabelsSchema } from "../lib/validation/betOptions";

describe("option label validation", () => {
  it("accepts two through ten unique options", () => {
    expect(optionLabelsSchema.parse(["Yes", "No"])).toEqual(["Yes", "No"]);
    expect(
      optionLabelsSchema.parse(
        Array.from({ length: 10 }, (_, index) => `Option ${index + 1}`)
      )
    ).toHaveLength(10);
  });

  it("rejects fewer than two or more than ten options", () => {
    expect(optionLabelsSchema.safeParse(["Only"]).success).toBe(false);
    expect(
      optionLabelsSchema.safeParse(
        Array.from({ length: 11 }, (_, index) => `Option ${index + 1}`)
      ).success
    ).toBe(false);
  });

  it("rejects duplicate labels regardless of case or whitespace", () => {
    expect(
      optionLabelsSchema.safeParse([" Team A ", "team a"]).success
    ).toBe(false);
  });

  it("rejects empty and oversized labels", () => {
    expect(optionLabelsSchema.safeParse(["Yes", " "]).success).toBe(false);
    expect(
      optionLabelsSchema.safeParse(["Yes", "x".repeat(51)]).success
    ).toBe(false);
  });
});
