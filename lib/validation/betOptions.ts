import { z } from "zod";

export const optionLabelsSchema = z
  .array(z.string().trim().min(1).max(50))
  .min(2)
  .max(10)
  .refine(
    (labels) =>
      new Set(labels.map((label) => label.toLowerCase())).size ===
      labels.length,
    "Option labels must be unique"
  );
