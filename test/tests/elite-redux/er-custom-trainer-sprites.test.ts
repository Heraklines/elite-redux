import { normalizeErCustomTrainerSprite } from "#data/elite-redux/er-custom-trainer-sprites";
import { describe, expect, it } from "vitest";

describe("ER custom trainer sprite catalog", () => {
  it("normalizes reusable appearance metadata", () => {
    const sprite = normalizeErCustomTrainerSprite("staff_rival", {
      staff_rival: {
        label: "Staff Rival",
        spriteKey: "staff_rival",
        genders: true,
        kind: "rival",
        tags: ["staff", " recurring "],
        author: "Artist",
        license: "cc-by",
        sourceUrl: "https://example.com/source",
      },
    });
    expect(sprite).toEqual({
      key: "staff_rival",
      label: "Staff Rival",
      spriteKey: "staff_rival",
      genders: true,
      kind: "rival",
      tags: ["staff", "recurring"],
      author: "Artist",
      license: "cc-by",
      sourceUrl: "https://example.com/source",
    });
  });

  it("rejects bad keys and path-like sprite keys", () => {
    expect(normalizeErCustomTrainerSprite("../bad", {})).toBeNull();
    expect(normalizeErCustomTrainerSprite("valid_key", { valid_key: { spriteKey: "../escape" } })).toBeNull();
  });
});
