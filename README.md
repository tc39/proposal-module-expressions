# JS Module Blocks

JS Module Blocks (“module blocks”) are an effort by [Daniel Ehrenberg] and [myself][surma]. It is the result of a lot of prior art, most notably [Justin Fagnani]’s [Inline Modules] proposal and [Domenic][domenic denicola]’s and [my][surma] [Blöcks] proposal.

## Problem space

The lack of inline modules in JavaScript has spawned some best practice that are really just workarounds and more often than not have negative performance implications. Sometimes, the lack of inline modules even form a hinderance to the adoption of APIs. A small sample of examples:

- Workers (and Worklets!) are often cited to be unergonomic because of the need of a separate file. Both Houdini and classic Web Workers can benefit greatly from inline modules.
- JavaScript cannot represent a “task” in a way that can be shared across agents, short of stringification.
- [Attempts][scheduler api] at building a scheduler for the web (á la GCD) have been constrained to the main thread due JS’s current inability to share code across realm boundaries.

## High-level

Module blocks are syntax for the contents of a module, which can then be imported.

```js
let moduleBlock = module {
  export let y = 1;
};
let moduleExports = await import(moduleBlock);
assert(moduleExports.y === 1);

assert(await import(moduleBlock) === moduleExports);  // cached in the module map
```

Importing a module block needs to be async, as module blocks may import other modules, which are fetched from the network. Module blocks may get imported multiple times, but will get cached in the module map and will return a reference to the same module.

```js
let moduleBlock = module {
  export * from "https://foo.com/script.mjs";
};
```

Module blocks are only imported through dynamic `import()`, and not through `import` statements, as there is no way to address them as a specifier string.

Relative import statements are resolved against with the path of the _declaring_ module. This is especially important when sending module blocks to a worker.

## Syntax details

```
PrimaryExpression :  InlineModuleExpression

InlineModuleExpression : module [no LineTerminator here] { Module }
```

As `module` is not a keyword in JavaScript, no newline is permitted between `module` and `{`. Probably this will be an easy bug to catch in practice, as accessing the variable `module` will usually be a ReferenceError.

## HTML Integration

Module blocks can be turned into an Object URL using `URL.createObjectURL(moduleBlock)` for backwards-compatibility and polyfillability. Maybe it even makes sense to allow stringification via `toString()`. Importing a module block’s object URL or the module block directly returns a reference to the same module from the module cache:

```js
const module = module { export default 42; }
const moduleURL = URL.createObjectURL(module);
assert(await import(module) == await import(moduleURL));
```

`import.meta` is inherited from the module the module block is syntactically located in. This is especially useful (if not essential) to make module blocks and the relative paths contained within behave as expected once they are shared across realms (e.g. sent to a worker):

```js
// main.js
const module = module {
	export async function main(url) {
		return import.meta.url;
	}
}
const worker = new Worker("./module-executor.js");
worker.postMessage(module);
worker.onmessage = ({data}) => assert(data == import.meta.url);

// module-executor.js
addEventListener("message", async ({data}) => {
	const {main} = await import(data);
	postMessage(await main());
});
```

## `ModuleBlock` object model

A module block expression `module { }` evaluates to an instance of a `ModuleBlock` class. Instances are frozen, and the same instance is returned each time for a particular Parse Node, like tagged template literals. `Module` instances have an internal slot [[ModuleBlockHostData]]. This internal slot is filled in by the host in a new host hook called when parsing each module block. (Alternative: A fresh, mutable `ModuleBlock` is returned each time the `module { }` is evaluated, with the same [[ModuleBlockHostData]] each time.) In `import()`, if the parameter has a [[ModuleBlockHostData]] internal slot, it is passed up as is to the dynamic import host hook, and ToString is only called on other values without this slot. 

*In HTML:* the [[ModuleBlockHostData]] is initialized to a new, hidden Blob which contains the module contents and a JavaScript MIME type (with the difference that this blob is created with a base URL derived from the path it syntactically occurred in, unlike normal blobs). `import()`ing one of these Module instances leads to the Blob's URL to be `import()`ed. This underlying Blob URL found in [[ModuleBlockHostData]] is what's returned from `URL.createObjectURL`.

## Realm interaction

As module blocks behave like module specifiers, they are independent of the Realm where they exist, and they cannot close over any lexically scoped variable outside of the module--they just close over the Realm in which they're imported.

For example, in conjunction with the [Realms proposal](https://github.com/tc39/proposal-realms), module blocks could permit syntactically local code to be executed in the context of the module:

```js
let module = module {
  export let o = Object;
};

let m = await import(module);
assert(m.o === Object);

let r1 = new Realm();
let m1 = await r1.import(module);
assert(m1.o === r1.globalThis.Object);
assert(m1.o !== Object);

assert(m.o !== m1.o);
```

## Use with workers

It should be possible to run a module Worker with module blocks, and to `postMessage` a module block to a worker:

```js
let workerCode = module {
  onmessage = function({data}) {
    let mod = await import(data);
    postMessage(mod.fn());
  }
};

let worker = new Worker(workerCode, {type: "module"});
worker.onmessage = ({data}) => alert(data);
worker.postMessage(module { export function fn() { return "hello!" } });
```

Maybe it would be possible to store a module block in IndexedDB as well, but this is more debatable, as persistent code could be a security risk.

## Integration with CSP

Content Security Policy (CSP) has two knobs which are relevant to module blocks

- Turning off `eval`, which also turns off other APIs which parse JavaScript. `eval` is disabled by default.
- Restricting the set of URLs allowed for sources, which also disables importing data URLs. By default, the set is unlimited.

Modules already allow the no-`eval` condition to be met: As modules are retrieved with `fetch`, they are not considered from `eval`, whether through `new Worker()` or `Realm.prototype.import`. Module blocks follow this: as they are parsed in syntax with the surrounding JavaScript code, they cannot be a vector for injection attacks, and they are not blocked by this condition.

The source list restriction is then applied to modules. The semantics of module blocks are basically equivalent to `data:` URLs, with the distinction that they would always be considered in the sources list (since it's part of a resource that was already loaded as script).

## Optimization potential

The hope would be that module blocks are just as optimizable as normal modules that are imported multiple times. For example, one hope would be that, in some engines, bytecode for a module block only needs to be generated once, even as it's imported multiple times in different Realms. However, type feedback and JIT-optimized code should probably be maintained separately for each Realm where the module block is imported, or one module's use would pollute another.

## Support in tools

Module blocks could be transpiled to either data URLs, or to a module in a separate file. Either transformation preserves semantics.

## Named modules and bundling.

This proposal only allows anonymous module blocks. There are other proposals for named module *bundles* (with URLs corresponding to the specifier of each JS module), including "[JS Module Bundles]" proposal, and [Web Bundles](https://www.ietf.org/id/draft-yasskin-wpack-bundled-exchanges-03.html). Note that there are significant privacy issues to solve with bundling to permit ad blockers; see [concerns from Brave](https://brave.com/webbundles-harmful-to-content-blocking-security-tools-and-the-open-web/).

## FAQs

### Should we really allow creation of workers using module blocks?

In my opinion: Yes. The requirement that workers are in a separate file is one of the most prominent pieces of feedback about why workers are hard to adopt. That’s why so many resort to Blob URLs or Data URLs, bringing along all kinds of difficulties, especially relating to paths and CSP.

### Can you close over variables? Can you reference values outside the module block?

No. Just like a separate file containing a ES module, you can only reference the global scope and import other modules.

### Can you _statically_ import other modules?

Yes. Just like with a separate file. This is completely valid:

```js
const m = module {
  import myApiWrapper from "./api-wrapper.js";

  await someTopLevelAwaitLogic();
}
```

### What about a nice shorthand for modules that just contain one function?

A short-hand for modules containing just one function would be convenient to have _if that is a common pattern_. Something like this:

```js
const m = module (x) => x**2;

// equivalent to

const m = module {
  export default (x) => x**2;
}
```

However, it is unclear whether this will actually be a common pattern, as it not only requires the module to have exactly one function, but also that it does not need any static imports. If the MVP of Module Blocks sees adoption and this becomes a frequently recurring pattern, a module shorthand seems like a good idea.

### Can Module Blocks help with bundling?

Mostly no. In _some_ scenarios Module Blocks can be sufficient to bundle:

```js
const count = module {
  let i = 0;

  export function count() {
    i++;
    return i;
  }
};

const uppercase = module {
  export function uppercase(string) {
    return string.toUpperCase();
  }
};

const { count } = await import(count);
const { uppercase } = await import(uppercase);

console.log(count()); // 1
console.log(uppercase("daniel")); // "DANIEL"
```

In the _general_ case, however, modules need to refer to each other. For that to work Module Blocks would need to be able to close over modules, which they can’t do:

```js
const count = module {
  let i = 0;

  export function count() {
    i++;
    return i;
  }
};

const uppercase = module {
  export function uppercase(string) {
    return string.toUpperCase();
  }
};

const combined = module {
  const { count } = await import(count);
  const { uppercase } = await import(uppercase);

  console.log(count()); // 1
  console.log(uppercase("daniel")); // "DANIEL"
};

// ReferenceError as we can't close over count or uppercase!!
```

To address the bundling problem, Dan Ehrenberg is maintaining a separate [proposal/idea][js module bundles].

### What about Blöcks?

[Blöcks] has been archived. This proposal is probably a better fit for JavaScript for a bunch of reasons:
- Blöcks was trying to introduce a new block type or even function. Both imply that you can close over/capture values outside that scope. We tried to allow that in Blöcks (because it is expected) which turned out to be a can of worms.
- Instead, Modules are well-explored, well-specified and well-understood by tooling, engines and developers. A lot of questions we had to worry about in Blöcks are naturally resolved through prior work in the modules space (e.g a module can only reference the global scope and do imports).
- Modules already have a caching mechanism.
- Modules are easier to  backwards compatible by making module blocks ObjectURL-able.

### What about TypeScript?

Within the same realm, typings should work in a straightforward way, similarly to how dynamic imports are currently typed.

Across realms, the story is a bit messy, but not due to Module Blocks. It is notoriously difficult to define what kind of scope a TypeScript file should be executed in (Main thread vs worker vs service worker), which is often solved by having multiple tsconfig.json file and composited projects. In that scenario, it’s even harder to have code that is shared across these TS projects.

When communicating with a Worker, you already need to force a type on the `event.data` to bring typing to the communication channel.

All in all, the Module Blocks does not make the typing situation worse or more complicated than it already is.

## Open questions
### What about CORS as Base URLs?

Imagine a scenario where `exampleA.com` opens a window or iframe to `exampleB.com`:

```js
// exampleA.com

const iframe = document.querySelector("iframe");
iframe.src = "https://exampleB.com";
iframe.contentWindow.postMessage(module {
  import "./someModule.js";

  fetch("./some_resource.json");
})
```

`exampleB.com` then imports (and as a result executes) the module block it receives in its realm. The `import` statement should most definitely relative to the module the modue block is _syntactically_ embedded in. What about the `fetch()`? Will the fetch request contain cookies? Should the import even work to begin with without CORS headers? This is an open question


[justin fagnani]: https://twitter.com/justinfagnani
[daniel ehrenberg]: https://twitter.com/littledan
[inline modules]: https://gist.github.com/justinfagnani/d26ba99aec5ffc02264907512c082622
[domenic denicola]: https://twitter.com/domenic
[surma]: https://twitter.com/dassurma
[shu]: https://twitter.com/_shu
[scheduler api]: https://github.com/WICG/main-thread-scheduling/
[blöcks]: https://github.com/domenic/proposal-blocks/tree/44668b647c48b116a8643d04e4e80735a3c5b78d
[js module bundles]: https://gist.github.com/littledan/c54efa928b7e6ce7e69190f73673e2a0
