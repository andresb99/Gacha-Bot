const test = require("node:test");
const assert = require("node:assert/strict");

const { formatDuration } = require("../src/utils/time");
const { todayKey } = require("../src/utils/date");

test("formatDuration formatea minutos y segundos", () => {
  assert.equal(formatDuration(1500), "0m 2s");
  assert.equal(formatDuration(60_000), "1m 0s");
});

test("formatDuration formatea horas cuando corresponde", () => {
  assert.equal(formatDuration(3_661_000), "1h 1m 1s");
});

test("todayKey retorna formato YYYY-MM-DD", () => {
  const key = todayKey("UTC");
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
});
