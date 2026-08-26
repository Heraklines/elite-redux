import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const editorSource = readFileSync(resolve(process.cwd(), "editor/suggestions.js"), "utf8");
const workerSource = readFileSync(resolve(process.cwd(), "workers/er-save-api/src/index.ts"), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("community suggestion access", () => {
  it("loads the review queue without an editor password", () => {
    const listRequest = sourceBetween(editorSource, "async function suggestionListRequest", "async function load");
    const load = sourceBetween(editorSource, "async function load", "const tabCount");
    const staffList = sourceBetween(
      workerSource,
      "async function handleCommunitySuggestionStaffList",
      "async function handleCommunitySuggestionStaffReview",
    );

    expect(listRequest).toContain("/community/editor-suggestions/staff/list");
    expect(listRequest).not.toContain("password:");
    expect(load).toContain("await suggestionListRequest()");
    expect(load).not.toContain("!password()");
    expect(load).toMatch(/catch \(cause\) \{[\s\S]*?loaded = true;[\s\S]*?\} finally/);
    expect(staffList).not.toContain("verifyEditorPassword");
  });

  it("keeps suggestion review actions password-protected", () => {
    const staffRequest = sourceBetween(
      editorSource,
      "async function staffRequest",
      "async function suggestionListRequest",
    );
    const staffReview = sourceBetween(
      workerSource,
      "async function handleCommunitySuggestionStaffReview",
      "// #endregion",
    );

    expect(staffRequest).toContain("password: password()");
    expect(staffReview).toContain("verifyEditorPassword");
    expect(staffReview).toContain("Invalid editor password.");
  });
});
