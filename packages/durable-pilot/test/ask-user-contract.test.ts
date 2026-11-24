// The ask_user question rules shared with PI WEB: the same fixture checks its copies in pi-web
// src/server/sessions/askUserContract.test.ts, so a field one copy keeps and another drops fails here or there.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { toQuestion, validateContext, validateQuestions } from "../src/workbench.ts";

type Param = Parameters<typeof toQuestion>[0];
const fixture = JSON.parse(readFileSync(new URL("./fixtures/ask-user-contract.json", import.meta.url), "utf8")) as {
	valid: { input: { context: string; questions: Param[] }; expected: { context: string; questions: unknown[] } };
	invalid: { name: string; questions: Param[]; error: string }[];
};

test("ask_user keeps every supported field and drops unknown ones, as PI WEB does", () => {
	assert.equal(validateContext(fixture.valid.input.context), fixture.valid.expected.context);
	assert.deepEqual(validateQuestions(fixture.valid.input.questions.map(toQuestion)), fixture.valid.expected.questions);
});

for (const { name, questions, error } of fixture.invalid) {
	test(`ask_user rejects ${name} with PI WEB's message`, () => {
		assert.throws(() => validateQuestions(questions.map(toQuestion)), { message: error });
	});
}
