// extractVideoId — development.md §5 step 2's URL recognizer, shared by the
// api route and the web input validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractVideoId } from "../dist/youtube.js";

const src = readFileSync(
  fileURLToPath(new URL("../src/youtube.ts", import.meta.url)),
  "utf8",
);
if (!src.includes("development.md §5")) {
  assert.fail("youtube.ts should reference its spec section");
}

test("watch URLs with v= param", () => {
  assert.equal(
    extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    extractVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s"),
    "dQw4w9WgXcQ",
  );
  // 12+ char ids would be invalid — must not partially match
  assert.equal(extractVideoId("https://youtube.com/watch?v=dQw4w9WgXcQQ"), null);
});

test("youtu.be short links", () => {
  assert.equal(extractVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc"), "dQw4w9WgXcQ");
});

test("shorts / embed / live paths", () => {
  assert.equal(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractVideoId("https://www.youtube.com/live/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("bare video id", () => {
  assert.equal(extractVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("non-YouTube input rejected", () => {
  assert.equal(extractVideoId("https://vimeo.com/123456"), null);
  assert.equal(extractVideoId("https://www.themealdb.com/dish/52771"), null);
  assert.equal(extractVideoId("not a url at all"), null);
  assert.equal(extractVideoId(""), null);
});
