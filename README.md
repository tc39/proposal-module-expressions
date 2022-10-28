# Module Expressions

Module expressions (previously known as “module blocks”) are an effort by [Surma][surma], [Daniel Ehrenberg], and [Nicolò Ribaudo]. It is the result of a lot of collaboration and prior art, most notably [Daniel Ehrenberg], [Justin Fagnani]’s [Inline Modules] proposal and [Domenic][domenic denicola]’s and [Surma][surma]'s [Blöcks] proposal.

## Problem space

Whenever developers try to make use of multi-threading in JavaScript — may that be Web Workers, Service Workers, Worklets like CSS Paint API or even other windows — they encounter a couple of problems. JavaScript’s inherent single-thread design prevents the sharing of memory (with the exception of `SharedArrayBuffer`) and as a direct result the sharing of functions and code. The typical paradigm of “run this function in another thread” is only possible in JavaScript today with workarounds that bring their own, significant drawbacks.

Libraries that bring this pattern to JavaScript (e.g. [ParllelJS][paralleljs] or [Greenlet][greenlet]) resort to stringification of functions to be able to send code from one realm to another, and re-parse it (either through `eval` or blobification).

This not only breaks a closure’s ability to close over values, but makes CSP problematic and can make path resolution (think `import()` or `fetch()`) behave unexpectedly, as data URLs and blob URLs are considered to be on a different host in some browsers.

```js
import greenlet from 'greenlet'

const API_KEY = "...";

let getName = greenlet(async username => {
  // It *looks* like API_KEY is accessible to this closure, but due to how
  // greenlet works, it is not.
  let url = `https://api.github.com/users/${username}?key=${API_KEY}`
  let res = await fetch(url)
  let profile = await res.json()
  return profile.name
});
```

Additionally, any API that loads code from a separate file has been struggling to see adoption (see Web Workers or CSS Painting API), _even when there are significant benefits to using them_. Forcing developers to put code into separate files is not only an [often-cited major DX hurdle][separate files], but is especially hard in the era of bundlers whose main purpose it is to put as much as possible into one file.

Any library that wants to make use of one of these APIs faces yet another additional challenge. If you published your library to npm and a user wants to use it via a CDN like [unpkg.com], the separate file is now being sourced from a different origin. Even with correct CORS headers, the origin will remain different, which affect how paths and as a result secondary resources will be resolved, if at all.

There is also the long-standing problem that JavaScript cannot represent a “task” in a way that can be shared across realms without having to deal with _at least_ one of the above problems. This has prevented any [attempt][scheduler api] at building a scheduler for the web (á la GCD) to go beyond the main thread, which is one of the main ergonomic benefits of schedulers.

Module expressions aims to significantly improve the situation with the introduction of one, minimally invasive addition to the language and its integration into the HTML standard.

## High-level

Module expressions are syntax for the contents of a module: they evaluate to a Module object.

```js
let mod = module {
  export let y = 1;
};
let moduleExports = await import(mod);
assert(moduleExports.y === 1);

assert(await import(mod) === moduleExports);  // cached in the module map
```

Importing a Module object needs to be async, as Module objects may import other modules from the network. Module objects may get imported multiple times, but will get cached in the module map and will return a reference to the same module namespace.

Module objects can only be imported through dynamic `import()`, and not through `import` statements, as there is no way to address them using a specifier string.

Relative import statements are resolved against with the path of the _outer_ module. This is especially important when importing Module objects from different files or different realms.

## Syntax details

```
PrimaryExpression :  ModuleExpression

ModuleExpression : `module` [no LineTerminator here] `{` ModuleBody? `}`
```

As `module` is not a keyword in JavaScript, no newline is permitted after `module`.

## HTML Integration

(HTML Integration is in progress in [this PR](https://github.com/whatwg/html/pull/7009).)

There are 4 main integration points in the HTML spec for Module objects:

### Worklets

[Worklets](https://html.spec.whatwg.org/multipage/worklets.html#worklets-worklet) (like [CSS Painting API](https://drafts.css-houdini.org/css-paint-api-1/) or [Audio Worklet](https://webaudio.github.io/web-audio-api/#audioworklet)) use the `addModule()` pattern to load a separate file into a Worklet context:

```js
CSS.paintWorklet.addModule("./my-paint-worklet.js");
```

The proposal aims to adjust `addModule` analogously to the Worker constructor to accept a Module object.

### Structured clone

Module objects are structured cloneable, allowing them to be sent via `postMessage()` (to Workers, ServiceWorkers or even other windows).

### `import.meta.url`

`import.meta` is inherited from the module the module block is _syntactically_ located in. This is especially useful (if not essential) to make module blocks and the relative paths contained within behave as expected once they are shared across realms (e.g. sent to a worker):

```js
// main.js
const mod = module {
	export async function main(url) {
		return import.meta.url;
	}
}
const worker = new Worker("./module-executor.js");
worker.postMessage(mod);
worker.onmessage = ({data}) => assert(data == import.meta.url);

// module-executor.js
addEventListener("message", async ({data}) => {
	const {main} = await import(data);
	postMessage(await main());
});
```

### Worker constructor

`new Worker()` currently only accepts a path to a worker file. The proposal originally aimed to also let it accept a Module object directly (for `{type: "module"}` workers). _This is currently put on hold in favor of the in-flight [Blank Worker proposal](https://github.com/whatwg/html/issues/6911) by Ben Kelly._

## Realm interaction

Module expressions behave similarly to function expressions: they capture the Realm where they are declared. This means that a Module object will always only be evaluated once, even if imported from multiple realms:

```javascript
let mod = module { export let x = true; };

let ns = await import(module);
let ns2 = globalThisFromDifferentRealm.eval("m => import(m)")(module);

assert(ns === ns2);
```

However, they cannot close over any lexically scoped variable outside of the module: this makes it possible to easily clone them, re-attaching them to a different realm.

For example, in conjunction with the [ShadowRealm proposal](https://github.com/tc39/proposal-shadowrealm), module expressions could permit syntactically local code to be executed in the context of the other realm:

```js
globalThis.flag = true;

let mod = module {
  export let hasFlag = !!globalThis.flag;
};

let m = await import(mod);
assert(m.hasFlag === true);

let realm = new ShadowRealm();
let realmHasFlag = await r1.importValue(mod, "hasFlag");
assert(realmHasFlag === false);
```

## Use with workers

The most basic version of a off-thread scheduler is to run a worker that receives, imports and executes module blocks:

```js
let workerModule = module {
  onmessage = async function({data}) {
    let mod = await import(data);
    postMessage(mod.default());
  }
};

let worker = new Worker({type: "module"});
worker.addModule(workerModule);
worker.onmessage = ({data}) => alert(data);
worker.postMessage(module { export default function() { return "hello!" } });
```

Maybe it would be possible to store a Module object in IndexedDB as well, but this is more debatable, as persistent code could be a security risk.

## Integration with CSP

Content Security Policy (CSP) has two knobs which are relevant to module blocks

- Turning off `eval`, which also turns off other APIs which parse JavaScript. `eval` is disabled by default.
- Restricting the set of URLs allowed for sources, which also disables importing data URLs. By default, the set is unlimited.

Modules already allow the no-`eval` condition to be met: as modules are retrieved with `fetch`, they are not considered from `eval`, whether through `new Worker()` or `ShadowRealm.prototype.importValue`. Module expressions follow this: as they are parsed in syntax with the surrounding JavaScript code, they cannot be a vector for injection attacks, and they are not blocked by this condition.

The source list restriction is then applied to modules. The semantics of module expressions are basically equivalent to `data:` URLs, with the distinction that they would always be considered in the sources list (since it's part of a resource that was already loaded as script).

## Optimization potential

The hope would be that module expressions are just as optimizable as normal modules that are imported multiple times. For example, one hope would be that, in some engines, bytecode for a module block only needs to be generated once, even as it's structured cloned and re-created multiple times in different Realms. However, type feedback and JIT-optimized code should probably be maintained separately for each Realm where the module block is re-created, or one module's use would pollute another.

## Support in tools

Module expressions could be transpiled to either data URLs, or to a module in a separate file. Either transformation preserves semantics.

## Named modules and bundling.

This proposal only allows anonymous module blocks. There are other proposals for named module _bundles_ (with URLs corresponding to the specifier of each JS module), including the [module declarations] proposal, and [Web Bundles](https://www.ietf.org/id/draft-yasskin-wpack-bundled-exchanges-03.html). Note that there are significant privacy issues to solve with bundling to permit ad blockers; see [concerns from Brave](https://brave.com/webbundles-harmful-to-content-blocking-security-tools-and-the-open-web/).

## TC39 Stage 3 Reviewers

- Jordan Harband (Coinbase)
- Leo Balter (Salesforce)
- Guy Bedford (OpenJS Foundation)
- Kris Kowal (Agoric)
- Jack Works (Sujitech)

## FAQs

### Can you close over variables? Can you reference values outside the module expression?

No. Just like a separate file containing a ES module, you can only reference the global scope and import other modules.

### Can you _statically_ import other modules?

Yes. Just like with a separate file. This is completely valid:

```js
const m = module {
  import myApiWrapper from "./api-wrapper.js";

  await someTopLevelAwaitLogic();
}
```

### Can module expressions help with bundling?

At first glance, it may look like module expressions could provide a bundling format for simple scenarios like this:

```js
const countModule = module {
  let i = 0;

  export function count() {
    i++;
    return i;
  }
};

const uppercaseModule = module {
  export function uppercase(string) {
    return string.toUpperCase();
  }
};

const { count } = await import(countModule);
const { uppercase } = await import(uppercaseModule);

console.log(count()); // 1
console.log(uppercase("daniel")); // "DANIEL"
```

In the _general_ case, however, modules need to refer to each other. For that to work Module expressions would need to be able to close over variables, which they can’t do:

```js
const countModule = module {
  let i = 0;

  export function count() {
    i++;
    return i;
  }
};

const uppercaseModule = module {
  export function uppercase(string) {
    return string.toUpperCase();
  }
};

const combinedModule = module {
  const { count } = await import(countModule);
  const { uppercase } = await import(uppercaseModule);

  console.log(count()); // 1
  console.log(uppercase("daniel")); // "DANIEL"
};

// ReferenceError as we can't close over countModule or uppercaseModule!!
```

To address the bundling problem, we are working on a separate [module declarations] proposal. With the proposal, the above code can be rewritten to:

```js
module countModule {
  let i = 0;

  export function count() {
    i++;
    return i;
  }
}

module uppercaseModule {
  export function uppercase(string) {
    return string.toUpperCase();
  }
}

module combinedModule {
  import { count } from countModule;
  import { uppercase } from uppercaseModule;

  console.log(count()); // 1
  console.log(uppercase("daniel")); // "DANIEL"
}
```

### What about Blöcks?

[Blöcks] has been archived. Module expressions are probably a better fit for JavaScript for a bunch of reasons:

- Blöcks was trying to introduce a new type of function. Both imply that you can close over/capture values outside that scope. We tried to allow that in Blöcks (because it is expected) which turned out to be a can of worms.
- Instead, Modules are well-explored, well-specified and well-understood by tooling, engines and developers. A lot of questions we had to worry about in Blöcks are naturally resolved through prior work in the modules space (e.g a module can only reference the global scope and do imports).
- Modules already have a caching mechanism.

### What _is_ a Module?

A Module expression evaluates to an instance of the new `Module` class, similarly to how function expressions evaluate to instances of the `Function` class.

The `Module` class introduced by this proposal is very limited, but the [Compartments proposal](https://github.com/tc39/proposal-compartments) is looking into expanding its capabilities.

### Are module expressions cached?

It depends on what you mean by “cached”. Module expressions have the same behavior as object literals. Meaning each time a module block is evaluated, a new module block is created.

```js
const arr = new Array(2);
for(let i = 0; i < 2; i++) {
  arr[i] = module {};
}
console.assert(arr[0] !== arr[1]);
console.assert(await import(arr[0]) !== await import(arr[1]));
```

However, Module objects participate in the module map just like any other module. So every expression block can only ever have one instance, unless it's structured cloned.

```js
const m1 = module{};
const m2 = m1;
console.assert(await import(m1) === await import(m2));
```

### What about TypeScript?

We've heard concerns from the TypeScript team that it could be difficult to type access to the global object within a module expression. Unfortunately, this is part of a bigger pattern with TypeScript:

It is notoriously difficult to define what kind of scope a TypeScript file should be executed in (Main thread vs worker vs service worker), which is often solved by having multiple `tsconfig.json` files and composited projects. In that scenario, it’s even harder to have code that is shared across these TS projects.

When communicating with a Worker, you already need to force a type on the `event.data` to bring typing to the communication channel.

All in all, it's hard to judge how much worse or more complicated module expressions makes the typing situation.

Nevertheless, we're thinking about this problem and in early discussions with the TypeScript team about possible solutions, such as a TS syntax for annotating the type of the global object for a module block, such as `module<GlobalInterface> { }`

### Should we really allow creation of workers using module expressions?

In my opinion: Yes. The requirement that workers are in a separate file is one of the most prominent pieces of feedback about why workers are hard to adopt. That’s why so many resort to Blob URLs or Data URLs, bringing along all kinds of difficulties, especially relating to paths and CSP. The risk here is that people start spawning a lot workers without regards to their cost, but I think the benefits of lowering the barrier to workers as an important performance primitive outweigh the risks. We have an [on-going discussion](https://github.com/tc39/proposal-js-module-blocks/issues/21) about this topic.

## Examples

### Greenlet

If you know [Jason Miller’s][developit] [Greenlet] (or my [Clooney]), module expressions would be the perfect building block for such off-main-thread scheduler libraries.

```js
import greenlet from "new-greenlet";

const func =
  greenlet(
    module {
      export default async function (endpoint, token) {
        const response = await fetch(endpoint, {headers: {"Authorization": `Bearer ${token}`}});
        const json = await response.json();
        /* ... more expensive processing of json ... */
        return json;
      }
    }
  );
const result = await func("/api", "secretToken");
```

<details>
<summary>Implementation of `new-greenlet` using Worker pooling</summary>

```js
// new-greenlet

// This is the code that is running in each worker. It accepts
// a module block via postMessage as an async “task” to run.
const workerModule = module {
  addEventListener("message", async ev => {
    const {args, module} = ev.data;
    const {default: task} = await import(module);
    const result = await task(...args);
    postMessage(result);
  });
};

// Will be assigned a function that puts a worker back in the pool
let releaseWorker;

// The pool itself is implemented as a queue using streams.
// Streams implement the most difficult part of pools; decoupling push from pull.
// I.e returing a promise for a request when no worker is available
// and als storing returned workers when there are no waiting requests.
const workerQueue = new ReadableStream(
  {
    workersCreated: 0,
    start(controller) {
      releaseWorker = w => controller.enqueue(w);
    },
    // `pull()` will only get called when someone requests a worker and
    // there is no worker in the queue. We use this as a signal to create
    // a new worker, provided we are under the threshold.
    // `pull()`’s return value is actually irrelevant, it’s only a signal that
    // the we _may_ use to enqueue something. If we don’t, the promise
    // will remain unsettled and resolve whenever the next call
    // to `controller.enqueue()` happens.
    async pull(controller) {
      if (this.workersCreated >= navigator.hardwareConcurrency) {
        return;
      }
      controller.enqueue(
        new Worker({type: "module", name: `worker${this.workersCreated}`})
          .addModule(workerModule)
      );
      this.workersCreated++;
    },
  },
  {highWaterMark: 0}
).getReader();

// Returns a promise for an available worker. If no worker is in the pool,
// it will wait for one.
function getWorker() {
  return workerQueue.read().then(({ value }) => value);
}

export default function greenlet(args, module) {
  return function(...args) {
    return new Promise((resolve) => {
      const worker = await getWorker();
      worker.postMessage({ args, module });
      worker.addEventListener(
        "message",
        (ev) => {
          const result = ev.data;
          resolve(result);
          releaseWorker(worker);
        },
        { once: true }
      );
    });
  };
}
```

</details>

[justin fagnani]: https://twitter.com/justinfagnani
[daniel ehrenberg]: https://twitter.com/littledan
[nicolò ribaudo]: https://twitter.com/NicoloRibaudo
[inline modules]: https://gist.github.com/justinfagnani/d26ba99aec5ffc02264907512c082622
[domenic denicola]: https://twitter.com/domenic
[surma]: https://twitter.com/dassurma
[shu]: https://twitter.com/_shu
[scheduler api]: https://github.com/WICG/main-thread-scheduling/
[blöcks]: https://github.com/domenic/proposal-blocks/tree/44668b647c48b116a8643d04e4e80735a3c5b78d
[module declarations]: https://github.com/tc39/proposal-module-fragments
[greenlet]: https://github.com/developit/greenlet
[developit]: https://twitter.com/_developit
[clooney]: https://github.com/GoogleChromeLabs/clooney
[css painting api]: https://developer.mozilla.org/en-US/docs/Web/API/CSS_Painting_API
[web workers]: https://developer.mozilla.org/en-US/docs/Web/API/Worker
[separate files]: https://www.w3.org/2018/12/games-workshop/report.html#threads
[houdini bundler guidance]: https://houdini.how/usage
[unpkg.com]: https://unpkg.com
[paralleljs]: https://github.com/parallel-js/parallel.js
