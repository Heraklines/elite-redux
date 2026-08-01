import { Button } from "#enums/buttons";
import { resolveItemManageVerticalCursor } from "#ui/party-ui-handler";
import { describe, expect, it } from "vitest";

describe("party item-management navigation", () => {
  it("visits all three active triple slots before the Transfer button", () => {
    expect(resolveItemManageVerticalCursor(0, 6, 3, Button.DOWN)).toBe(1);
    expect(resolveItemManageVerticalCursor(1, 6, 3, Button.DOWN)).toBe(2);
    expect(resolveItemManageVerticalCursor(2, 6, 3, Button.DOWN)).toBe(7);
    expect(resolveItemManageVerticalCursor(7, 6, 3, Button.DOWN)).toBe(3);
  });

  it("navigates back from the bench through Transfer to the third active slot", () => {
    expect(resolveItemManageVerticalCursor(3, 6, 3, Button.UP)).toBe(7);
    expect(resolveItemManageVerticalCursor(7, 6, 3, Button.UP)).toBe(2);
  });

  it("retains single and double item-management ordering", () => {
    expect(resolveItemManageVerticalCursor(0, 3, 1, Button.DOWN)).toBe(7);
    expect(resolveItemManageVerticalCursor(7, 3, 1, Button.DOWN)).toBe(1);
    expect(resolveItemManageVerticalCursor(0, 3, 2, Button.DOWN)).toBe(1);
    expect(resolveItemManageVerticalCursor(1, 3, 2, Button.DOWN)).toBe(7);
  });
});
