import assert from "node:assert/strict";
import test from "node:test";
import { BROWSER_UNAVAILABLE, findSystemChromium } from "../scripts/run-workbench-chat-acceptance.mjs";

test("reports a stable typed browser-unavailable result", () => {
  assert.deepEqual(BROWSER_UNAVAILABLE, {
    type: "BROWSER_UNAVAILABLE",
    code: "BROWSER_UNAVAILABLE",
    message: "No supported system Chromium was found. Set CHROME_BIN to an executable Chromium binary.",
  });
  assert.equal(findSystemChromium({ CHROME_BIN: "/definitely/not/chromium", PATH: "" }), undefined);
});
