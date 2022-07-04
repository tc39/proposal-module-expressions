# Modules evaluation and caching

This proposal aims to enforce some new guarantees around how module evaluations are cached and in which contexts. While ECMAScript already guarantees that importing the same specifier from the same parent module results in a single evaluation, Module Blocks increases the complexity by separating evaluation module records from compilation module records and permitting compiled module records to be passed between realms. We thus need to extend the idempotency of resolution to handle these new interactions.

## Invariants

1. Importing a module with the same string specifier twice from the same file results in a single evaluation (this is already guaranteed by ECMA-262):
   ```js
   // main.js
   import { check as c1 } from "./file.js";
   import { check as c2 } from "./file.js";
   assert(c1 === c2);
   
   // file.js
   export const check = {};
   ```
   ```js
   // main.js
   import { check as c1 } from "./file.js";
   const { check: c2 } = await import("./file.js");
   assert(c1 === c2);
   
   // file.js
   export const check = {};
   ```
   ```js
   // main.js
   const { check: c1 } = await import("./file.js");
   const { check: c2 } = await import("./file.js");
   assert(c1 === c2);
   
   // file.js
   export const check = {};
   ```
2. Importing a module with the same string specifier from two different modules defined in the same file and evaluated the same Realm results in a single evaluation:
   ```js
   // main.js
   import { check as c1 } from "./file.js";
   const mod = module { export { check } from "./file.js"; };
   const { check: c2 } = await import(mod);
   assert(c1 === c2);
   
   // file.js
   export const check = {};
   ```
   ```js
   // main.js
   const mod1 = module { export { check } from "./file.js"; };
   const mod2 = module { export { check } from "./file.js"; };
   const { check: c2 } = await import(mod1);
   const { check: c2 } = await import(mod2);
   assert(c2 === c2);
   
   // file.js
   export const check = {};
   ```
3. Importing the same module block twice _from the same Realm_, even if from different modules, results in a single evaluation:
   ```js
   globalThis.count = 0;
   const mod = module { globalThis.count++; };
   await import(mod);
   await import(mod);
   assert(globalThis.count === 1);
   ```
   ```js
   // main.js
   import { mod, check as c1 } from "./dep.js";
   const { check: c2 } = await import(mod);
   assert(c1 === c2);

   // dep.js
   export const mod = module { export const check = {}; };
   export const { check } = await import(mod);
   ```
4. A module block is evaluated in the same realm as where it is imported:
   ```js
   const mod = module { globalThis.modEvaluated = true; };
   const realm = createLegacyRealm(); // [1]
   await realm.eval(`s => import(s)`)(mod);
   assert(globalThis.modEvaluated === undefined);
   assert(realm.modEvaluated === true);
   ```
   This is consistent with the behavior of imports with string specifiers.
5. Importing the same module block twice _from different Realms_ results in multiple evaluations:
   ```js
   const realm = createLegacyRealm(); // [1]
   globalThis.count = 0;
   realm.count = 0;
   const mod = module { globalThis.count++; export const check = {}; };
   const { check: c1 } = await import(mod);
   const { check: c2 } = await realm.eval("s => import(s)")(mod);
   assert(globalThis.count + realm.count === 2);
   assert(c1 !== c2);
   ```
   This is consistent with the behavior of imports with string specifiers.
6. Importing two different module blocks results in two evaluations and two different namespace objects. Two module blocks `mod1` and `mod2` are considered different if `mod1 !== mod2`:
   ```js
   globalThis.count = 0;
   const mod1 = module { globalThis.count++; export const check = {}; };
   const mod2 = module { globalThis.count++; export const check = {}; };
   const { check: c1 } = await import(mod1);
   const { check: c1 } = await import(mod2);
   assert(c1 !== c2);
   assert(globalThis.count === 2);
   ```
   ```js
   globalThis.count = 0;
   const mod = module { globalThis.count++; export const check = {} };
   const modClone = structuredClone(mod);
   assert(mod !== modClone);
   const { check: c1 } = await import(mod);
   const { check: c2 } = await import(modClone);
   assert(c1 !== c2);
   assert(globalThis.count === 2);
   ```
   ```js
   globalThis.count = 0;
   const mod = module {};
   const worker = new Worker(`data:text/javascript,
     addEventListener("message", msg => postMessage(msg.data))
   `);
   worker.addEventListener("message", ({ data: mod2 }) => {
     assert(mod !== mod2);
     const { check: c1 } = await import(mod);
     const { check: c2 } = await import(mod2);
     assert(c1 !== c2);
     assert(globalThis.count === 2);
   });
   worker.postMessage(mod);
   ```

## Invariants enforced by the HTML specification

These invariants cannot be enforced by ECMA-262, since it doesn't define how cloning works and how string specifiers are resolved. They will be respected by the HTML integration, and the champion group suggests that hosts that have a similar modules model could follow these patterns.

7. When serializing&deserializing a module block, the "referrer" used as the base to resolve string specifiers should be kept the same:
   ```js
   // /main.js
   const worker = new Worker("./worker/worker.js");
   worker.postMessage(module {
     import dir from "./foo.js";
     assert(dir === "/");
   });

   // /foo.js
   export default "/";

   // /worker/worker.js
   addEventListener("message", msg => import(msg.data));

   // /worker/foo.js
   export default "/worker";
   ```
   It follows that when importing two copies of the same module block from the same realm, transitive dependencies should only be evaluated once:
   ```js
   globalThis.count = 0;
   const mod = module { export { check } from "./foo.js"; };
   const modClone = structuredClone(mod);
   const { check: c1 } = await import(mod);
   const { check: c2 } = await import(modClone);
   assert(c1 === c2);
   assert(globalThis.count === 1);

   // file.js
   globalThis.count++;
   export const check = {};
   ```
   We will be able to enforce the second example in ecma262 if we move the serialization&deserialization algorithms to ecma262: [tc39/ecma262#2555](https://github.com/tc39/ecma262/issues/2555).

---

[1] The `createLegacyRealm` function used in some code snippets returns the `globalThis` object of a new Realm. In browsers it can be implemented like this:

```js
function createLegacyRealm() {
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  document.body.appendChild(iframe);
  return iframe.contentWindow;
}
```