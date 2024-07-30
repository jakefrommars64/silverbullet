import "fake-indexeddb/auto";
import { IndexedDBKvPrimitives } from "../data/indexeddb_kv_primitives.ts";
import { cleanupEmptyObjects, DataStore } from "../data/datastore.ts";
import { DenoKvPrimitives } from "../data/deno_kv_primitives.ts";
import { KvPrimitives } from "../data/kv_primitives.ts";
import { assertEquals, assertThrows } from "$std/testing/asserts.ts";
import { PrefixedKvPrimitives } from "../data/prefixed_kv_primitives.ts";
import { Query } from "../../plug-api/types.ts";

async function test(db: KvPrimitives) {
  const datastore = new DataStore(new PrefixedKvPrimitives(db, ["ds"]), {
    count: (arr: any[]) => arr.length,
    $query: (_query: Query) => {
      return Promise.resolve([]);
    },
  });
  await datastore.set(["user", "peter"], { name: "Peter" });
  await datastore.set(["user", "hank"], { name: "Hank" });
  let results = await datastore.query({
    prefix: ["user"],
    filter: ["=", ["attr", "name"], ["string", "Peter"]],
  });
  assertEquals(results, [{ key: ["user", "peter"], value: { name: "Peter" } }]);

  assertEquals(
    [{ key: ["user", "hank"], value: { name: "Hank" } }, {
      key: ["user", "peter"],
      value: { name: "Peter" },
    }],
    await datastore.query({
      prefix: ["user"],
      orderBy: [{ expr: ["attr", "name"], desc: false }],
    }),
  );
  assertEquals(
    [{ key: ["user", "peter"], value: { name: "Peter" } }, {
      key: ["user", "hank"],
      value: { name: "Hank" },
    }],
    await datastore.query({
      prefix: ["user"],
      orderBy: [{ expr: ["attr", "name"], desc: true }],
    }),
  );

  await datastore.batchSet<any>([
    { key: ["kv", "name"], value: "Zef" },
    { key: ["kv", "data"], value: new Uint8Array([1, 2, 3]) },
    {
      key: ["kv", "complicated"],
      value: {
        name: "Frank",
        parents: ["John", "Jane"],
        address: {
          street: "123 Main St",
          city: "San Francisco",
        },
      },
    },
  ]);
  assertEquals(await datastore.get(["kv", "name"]), "Zef");
  assertEquals(await datastore.get(["kv", "data"]), new Uint8Array([1, 2, 3]));
  results = await datastore.query({
    prefix: ["kv"],
    filter: ["=~", ["attr", ""], ["regexp", "Z.f", "i"]],
  });
  assertEquals(results, [{ key: ["kv", "name"], value: "Zef" }]);
  results = await datastore.query({
    prefix: ["kv"],
    filter: ["and", ["=", ["attr", "parents"], ["string", "John"]], [
      "=",
      ["attr", ["attr", "address"], "city"],
      ["string", "San Francisco"],
    ]],
    select: [
      { name: "parents" },
      {
        name: "name",
        expr: ["+", ["attr", "name"], ["string", "!"]],
      },
      {
        name: "parentCount",
        expr: ["call", "count", [["attr", "parents"]]],
      },
    ],
  });
  assertEquals(results.length, 1);
  assertEquals(results[0], {
    key: ["kv", "complicated"],
    value: { name: "Frank!", parentCount: 2, parents: ["John", "Jane"] },
  });

  assertEquals(
    await datastore.query({
      prefix: ["kv"],
      limit: ["number", 1],
      select: [
        {
          name: "random",
          expr: ["query", { querySource: "bla" }],
        },
      ],
    }),
    [{ key: ["kv", "complicated"], value: { random: [] } }],
  );

  // Test object enrichment
  datastore.objectEnrichers = [
    { // fullName
      where: ["=", ["attr", "tags"], ["string", "person"]],
      attributes: {
        fullName: ["+", ["+", ["attr", "firstName"], ["string", " "]], [
          "attr",
          "lastName",
        ]],
      },
    },
    {
      where: ["=", ["attr", "tags"], ["string", "person"]],
      attributes: {
        "pageDecoration.prefix.bla.doh": ["+", ["string", "🧑 "], [
          "attr",
          "fullName",
        ]],
      },
    },
    // Test extending existing array attributes
    {
      where: ["boolean", true],
      attributes: {
        "listAttribute": ["array", [["string", "newValue1"]]],
        "nested.listAttribute": ["array", [["string", "newValue1"]]],
      },
    },
    {
      where: ["boolean", true],
      attributes: {
        "listAttribute": ["array", [["string", "newValue2"]]],
        "nested.listAttribute": ["array", [["string", "newValue2"]]],
      },
    },
    // Test not being able to override existing attributes
    {
      where: ["boolean", true],
      attributes: {
        "lastName": ["string", "Shouldn't be set"],
      },
    },
    {
      where: ["=", ["attr", "tags"], ["string", "person"]],
      attributes: {
        "existingObjAttribute.another": ["string", "value"],
      },
    },
  ];

  const obj: Record<string, any> = {
    firstName: "Pete",
    lastName: "Smith",
    existingObjAttribute: {
      something: true,
    },
    tags: ["person"],
  };
  const pristineCopy = JSON.parse(JSON.stringify(obj));

  datastore.enrichObject(obj);
  // console.log("Enrhiched", obj);
  assertEquals(obj.fullName, "Pete Smith");
  assertEquals(obj.lastName, "Smith");
  assertEquals(obj.pageDecoration, {
    prefix: { bla: { doh: "🧑 Pete Smith" } },
  });
  assertEquals(obj.existingObjAttribute.something, true);
  assertEquals(obj.existingObjAttribute.another, "value");
  assertEquals(obj.listAttribute, ["newValue1", "newValue2"]);
  assertEquals(obj.nested.listAttribute, ["newValue1", "newValue2"]);

  // And now let's clean it again
  datastore.cleanEnrichedObject(obj);

  assertEquals(obj, pristineCopy);

  // Validate no async functions are called in the object enrichment
  datastore.objectEnrichers = [
    {
      where: ["call", "$query", []],
      attributes: {},
    },
  ];

  assertThrows(() => {
    datastore.enrichObject({});
  });
}

Deno.test("Test Deno KV DataStore", async () => {
  const tmpFile = await Deno.makeTempFile();
  const db = new DenoKvPrimitives(await Deno.openKv(tmpFile));
  await test(db);
  db.close();
  await Deno.remove(tmpFile);
});

Deno.test("Test IndexDB DataStore", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const db = new IndexedDBKvPrimitives("test");
  await db.init();
  await test(db);
  db.close();
});

Deno.test("Test cleanupEmptyObjects", () => {
  const testObject: any = {
    attribute1: 10,
    another: { nested: 20, removeMe: {} },
    list: [],
    removeMe: {
      deeply: {},
    },
    another2: [1, 2, 3],
  };
  cleanupEmptyObjects(testObject);
  assertEquals(testObject, {
    attribute1: 10,
    another: { nested: 20 },
    list: [],
    another2: [1, 2, 3],
  });
});
