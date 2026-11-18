import { test } from "node:test";
import * as assert from "node:assert/strict";
import { graphPlaces, isPlace } from "../core/graphWatch";

test("graphPlaces: the graph file itself, and the file it leads to when it is a link", () => {
  assert.deepEqual(graphPlaces("C:\g\graph.json", "C:\g\graph.json", true), ["C:\g\graph.json"]);
  assert.deepEqual(graphPlaces("C:\g\graph.json", "c:\G\Graph.json", true), ["C:\g\graph.json"], "Windows: the same file in other letter case");
  assert.deepEqual(graphPlaces("C:\g\graph.json", "D:\far\real.json", true), ["C:\g\graph.json", "D:\far\real.json"]);
  assert.deepEqual(graphPlaces("/g/graph.json", undefined, false), ["/g/graph.json"], "a link that leads nowhere: the link alone");
  assert.deepEqual(graphPlaces("/g/graph.json", "/g/Graph.json", false), ["/g/graph.json", "/g/Graph.json"]);
});

test("isPlace: an event counts for the graph only when it names that very file; a name is never a pattern", () => {
  assert.equal(isPlace("C:\g\graph[1].json", "C:\g\graph[1].json", true), true);
  assert.equal(isPlace("C:\g\graph1.json", "C:\g\graph[1].json", true), false);
  assert.equal(isPlace("c:\G\GRAPH[1].json", "C:\g\graph[1].json", true), true);
  assert.equal(isPlace("/g/Graph.json", "/g/graph.json", false), false);
  assert.equal(isPlace("/g/./graph.json", "/g/graph.json", false), true);
});
