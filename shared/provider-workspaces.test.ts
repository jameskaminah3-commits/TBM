import assert from "node:assert/strict";
import test from "node:test";
import { countNoun, getProviderWorkspaceKeys, workspacesHaveCustomQuotes } from "./provider-workspaces.ts";

test("a host with stays only sees stays, never vehicles", () => {
  assert.deepEqual(getProviderWorkspaceKeys(["stays"], { stays: 2 }), ["stays"]);
});

test("a chef sees chef services only", () => {
  assert.deepEqual(getProviderWorkspaceKeys(["cooks"], {}), ["cooks"]);
});

test("a provider with several services sees each, in a steady order", () => {
  assert.deepEqual(getProviderWorkspaceKeys(["experiences", "cooks", "errands"], {}), ["cooks", "errands", "experiences"]);
  assert.deepEqual(getProviderWorkspaceKeys(["cars", "stays"], { stays: 2, cars: 4 }), ["stays", "cars"]);
});

test("a listing TBM assigned adds its service even if the account doesn't name it", () => {
  assert.deepEqual(getProviderWorkspaceKeys(["stays"], { stays: 1, experiences: 1 }), ["stays", "experiences"]);
});

test("with no services set and no listings, every workspace shows", () => {
  assert.deepEqual(getProviderWorkspaceKeys([], {}), ["stays", "cars", "cooks", "errands", "experiences"]);
  assert.deepEqual(getProviderWorkspaceKeys(["unknown"], {}), ["stays", "cars", "cooks", "errands", "experiences"]);
});

test("custom quotes only for chef services and experiences", () => {
  assert.equal(workspacesHaveCustomQuotes(["stays", "cars"]), false);
  assert.equal(workspacesHaveCustomQuotes(["cooks"]), true);
  assert.equal(workspacesHaveCustomQuotes(["experiences"]), true);
});

test("counts read naturally", () => {
  assert.equal(countNoun(1, "stays"), "1 stay");
  assert.equal(countNoun(4, "cars"), "4 vehicles");
});
