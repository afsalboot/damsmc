import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const base = "docs/audits/frontend-2026-10-16";
const read = async phase => JSON.parse(await readFile(`${base}/${phase}/results.json`, "utf8"));
const after = await read("after"), states = await read("states"), recovery = await read("recovery");
const dense = await read("dense"), interaction = await read("interaction");
for (const run of [after, states, recovery, dense, interaction]) {
  assert.equal(run.error, undefined, `${run.phase}: runner failed`);
  assert.equal(run.exceptions.length, 0, `${run.phase}: browser exception`);
  assert.equal(run.missingFixtures.length, 0, `${run.phase}: missing fixture`);
  assert.equal(run.blockedWrites.length, 0, `${run.phase}: attempted API write`);
  for (const screen of run.screens) for (const sample of screen.samples) {
    assert.ok(sample.documentWidth <= sample.width + 1, `${run.phase}/${screen.screen}/${screen.state || "normal"}: overflow at ${sample.width}`);
    assert.equal(sample.unnamed.length, 0, `${run.phase}/${screen.screen}: unnamed field`);
  }
  assert.equal(run.interactions.length, 7);
  for (const dialog of run.interactions) {
    assert.equal(dialog.blocked, undefined);
    assert.equal(dialog.opened.dialogs.length, 1);
    assert.ok(dialog.opened.dialogs[0].name);
    assert.equal(dialog.opened.dialogs[0].focusInside, true);
    assert.ok(dialog.opened.dialogs[0].rect.top >= 0);
    assert.ok(dialog.opened.dialogs[0].rect.bottom <= 600);
    assert.equal(dialog.opened.unnamed.length, 0);
    assert.equal(dialog.keyboard.tabStayedInside, true);
    assert.equal(dialog.keyboard.shiftTabStayedInside, true);
    assert.equal(dialog.dialogsAfterEscape, 0);
  }
  assert.equal(run.navigation.dialog, true);
  assert.equal(run.navigation.expanded, "true");
  assert.equal(run.checkout.dialog.open, true);
  assert.equal(run.checkout.dialog.focusInside, true);
  for (const mode of ["cash", "split"]) {
    assert.equal(run.checkout[mode].unnamed.length, 0);
    assert.ok(run.checkout[mode].documentWidth <= 391);
  }
}
const normal = after.screens.filter(screen => !screen.state);
assert.equal(normal.length, 19);
assert.equal(normal.reduce((total, screen) => total + screen.samples.length, 0), 342);
assert.equal(after.screens.filter(screen => screen.state === "dense").length, 7);
assert.equal(states.screens.filter(screen => screen.state === "empty").length, 11);
assert.equal(states.screens.filter(screen => screen.state === "error").length, 11);
assert.equal(states.screens.filter(screen => screen.state === "loading").length, 5);
assert.equal(recovery.screens.length, 11);
assert.ok(recovery.screens.every(screen => screen.recovered), "Retry did not recover a screen");
assert.ok(interaction.interactions.every(dialog => dialog.focusRestored), "Dialog trigger focus was not restored");
assert.equal(interaction.navigation.escapeClosed, true);
assert.equal(interaction.navigation.closedOnResize, true);
await assert.rejects(access("src/app/frontend-audit-preview"), "Temporary preview route must be absent");
console.log("PASS: 19 screens, 304 requested-width checks + 38 landscape/reflow checks; 7 populated-table screens across 16 widths; 27 state previews; 11 retry recoveries; 7 create dialogs, navigation and cash/split checkout; no browser exceptions or API writes.");
