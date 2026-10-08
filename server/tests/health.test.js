// GET /api/health — sem tocar no banco: supabaseClient.js substituído por
// um dublê (mesmo padrão de auth-login.test.js).
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import express from "express";

const SUPA_URL = pathToFileURL(path.join(import.meta.dirname, "..", "supabaseClient.js")).href;

// Comportamento da "consulta" controlado por teste.
let dbBehavior = "ok";
mock.module(SUPA_URL, {
  exports: {
    sql: () =>
      dbBehavior === "ok"
        ? Promise.resolve([{ "?column?": 1 }])
        : Promise.reject(new Error("tenant/user postgres.xyz not found")),
  },
});

const { healthRouter } = await import("../routes/health.js");

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use("/api/health", healthRouter);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("GET /api/health — banco respondendo → 200 {ok:true}, sem cache", async () => {
  dbBehavior = "ok";
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("GET /api/health — banco fora → 503 {ok:false}, sem vazar o erro", async () => {
  dbBehavior = "fail";
  const origError = console.error;
  console.error = () => {};
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { ok: false });
    assert.ok(!text.includes("tenant"), "não pode expor o erro do banco");
  } finally {
    console.error = origError;
  }
});
