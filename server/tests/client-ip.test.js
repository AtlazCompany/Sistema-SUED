// Fase 5 / Lote 9 — IP real do cliente atrás do Cloudflare/Render.
// Sem isso, req.ip é o IP do proxy: todos os visitantes dividiam o mesmo
// contador de rate limit (login, link público do orçamento). Teste puro,
// sem banco nem servidor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp } from "../utils.js";

const req = (headers, ip = "10.0.0.1") => ({ ip, headers });

test("sem cabeçalho configurado → usa req.ip (ambiente local)", () => {
  assert.equal(clientIp(req({ "cf-connecting-ip": "203.0.113.9" }), null), "10.0.0.1");
});

test("cabeçalho configurado e presente → usa o IP do cabeçalho", () => {
  assert.equal(clientIp(req({ "cf-connecting-ip": "203.0.113.9" }), "cf-connecting-ip"), "203.0.113.9");
});

test("cabeçalho configurado mas ausente → cai para req.ip", () => {
  assert.equal(clientIp(req({}), "cf-connecting-ip"), "10.0.0.1");
});

test("valor com espaços ou lista → só o primeiro IP, sem espaços", () => {
  assert.equal(clientIp(req({ "cf-connecting-ip": " 203.0.113.9 , 1.1.1.1" }), "cf-connecting-ip"), "203.0.113.9");
});
