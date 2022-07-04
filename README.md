# JS Module Blocks

JS Module Blocks (“module blocks”) are an effort by [Surma][surma]. It is the result of a lot of collaboration and prior art, most notably [Daniel Ehrenberg], [Justin Fagnani]’s [Inline Modules] proposal and [Domenic][domenic denicola]’s and [Surma][surma]'s [Blöcks] proposal.

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

Module blocks aims to significantly improve the situation with the introduction of one, minimally invasive addition to the language and its integration into the HTML standard.

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

Importing a module block needs to be async, as module blocks may import other modules from the network. Module blocks may get imported multiple times, but will get cached in the module map and will return a reference to the same module.

Module blocks are only imported through dynamic `import()`, and not through `import` statements, as there is no way to address them as a specifier string.

Relative import statements are resolved against with the path of the _declaring_ module. This is especially important when sending module blocks to other realms.

## Syntax details

```
PrimaryExpression :  ModuleBlockExpression

ModuleBlockExpression : `module` [no LineTerminator here] `{` ModuleBody? `}`
```

As `module` is not a keyword in JavaScript, no newline is permitted after `module`.

## HTML Integration

(HTML Integration is in progress in [this PR](https://github.com/whatwg/html/pull/7009).)

There are 4 main integration points in the HTML spec for Module Blocks:

### Worklets

[Worklets](https://html.spec.whatwg.org/multipage/worklets.html#worklets-worklet) (like [CSS Painting API](https://drafts.css-houdini.org/css-paint-api-1/) or [Audio Worklet](https://webaudio.github.io/web-audio-api/#audioworklet)) use the `addModule()` pattern to load a separate file into a Worklet context:

```js
CSS.paintWorklet.addModule("./my-paint-worklet.js");
```

The proposal aims to adjust `addModule` analogously to the Worker constructor to accept a Module Block.

### Structured clone

Module Blocks are structured cloneable, allowing them to be sent via `postMessage()` (to Workers, ServiceWorkers or even other windows).

### `import.meta.url`

`import.meta` is inherited from the module the module block is _syntactically_ located in. This is especially useful (if not essential) to make module blocks and the relative paths contained within behave as expected once they are shared across realms (e.g. sent to a worker):

```js
// main.js
const moduleBlock = module {
	export async function main(url) {
		return import.meta.url;
	}
}
const worker = new Worker("./module-executor.js");
worker.postMessage(moduleBlock);
worker.onmessage = ({data}) => assert(data == import.meta.url);

// module-executor.js
addEventListener("message", async ({data}) => {
	const {main} = await import(data);
	postMessage(await main());
});
```

### Worker constructor

`new Worker()` currently only accepts a path to a worker file. The proposal originally aimed to also let it accept a Module Block directly (for `{type: "module"}` workers). _This is currently put on hold in favor of the in-flight [Blank Worker proposal](https://github.com/whatwg/html/issues/6911) by Ben Kelly._

## Realm interaction

As module blocks behave like module specifiers, they are independent of the Realm where they exist, and they cannot close over any lexically scoped variable outside of the module--they just close over the Realm in which they're imported.

For example, in conjunction with the [Realms proposal](https://github.com/tc39/proposal-realms), module blocks could permit syntactically local code to be executed in the context of the module:

```js
let moduleBlock = module {
  export let o = Object;
};

let m = await import(moduleBlock);
assert(m.o === Object);

let r1 = new Realm();
let m1 = await r1.import(moduleBlock);
assert(m1.o === r1.globalThis.Object);
assert(m1.o !== Object);

assert(m.o !== m1.o);
```

## Use with workers

The most basic version of a off-thread scheduler is to run a worker that receives, imports and executes module blocks:

```js
let workerBlock = module {
  onmessage = async function({data}) {
    let mod = await import(data);
    postMessage(mod.default());
  }
};

let worker = new Worker({type: "module"}).addModule(workerBlock);
worker.onmessage = ({data}) => alert(data);
worker.postMessage(module { export default function() { return "hello!" } });
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

This proposal only allows anonymous module blocks. There are other proposals for named module _bundles_ (with URLs corresponding to the specifier of each JS module), including "[JS Module Bundles]" proposal, and [Web Bundles](https://www.ietf.org/id/draft-yasskin-wpack-bundled-exchanges-03.html). Note that there are significant privacy issues to solve with bundling to permit ad blockers; see [concerns from Brave](https://brave.com/webbundles-harmful-to-content-blocking-security-tools-and-the-open-web/).

## TC39 Stage 3 Reviewers

- Nicolò Ribaudo (Invited Expert - Babel)
- Jordan Harband (Coinbase)
- Leo Balter (Salesforce)
- Guy Bedford (OpenJS Foundation)
- Kris Kowal (Agoric)
- Jack Works (Sujitech)

## FAQs

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

### Can Module Blocks help with bundling?

At first glance, it may look like Module Blocks could provide a bundling format for simple scenarios like this:

```js
const countBlock = module {
  let i = 0;

  export function count() {
    i++;
    return i;
  }
};

const uppercaseBlock = module {
  export function uppercase(string) {
    return string.toUpperCase();
  }
};

const { count } = await import(countBlock);
const { uppercase } = await import(uppercaseBlock);

console.log(count()); // 1
console.log(uppercase("daniel")); // "DANIEL"
```

In the _general_ case, however, modules need to refer to each other. For that to work Module Blocks would need to be able to close over modules, which they can’t do:

```js
const countBlock = module {
  let i = 0;

  export function count() {
    i++;
    return i;
  }
};

const uppercaseBlock = module {
  export function uppercase(string) {
    return string.toUpperCase();
  }
};

const combinedBlock = module {
  const { count } = await import(countBlock);
  const { uppercase } = await import(uppercaseBlock);

  console.log(count()); // 1
  console.log(uppercase("daniel")); // "DANIEL"
};

// ReferenceError as we can't close over countBlock or uppercaseBlock!!
```

To address the bundling problem, Dan Ehrenberg is maintaining a separate [proposal/idea][js module bundles].

### What about Blöcks?

[Blöcks] has been archived. Module blocks is probably a better fit for JavaScript for a bunch of reasons:

- Blöcks was trying to introduce a new type of function. Both imply that you can close over/capture values outside that scope. We tried to allow that in Blöcks (because it is expected) which turned out to be a can of worms.
- Instead, Modules are well-explored, well-specified and well-understood by tooling, engines and developers. A lot of questions we had to worry about in Blöcks are naturally resolved through prior work in the modules space (e.g a module can only reference the global scope and do imports).
- Modules already have a caching mechanism.

### What _is_ a Module Block?

We are [still discussing the details](https://github.com/tc39/proposal-js-module-blocks/issues/1), but it’s just an object.

### Are module blocks cached?

It depends on what you mean by “cached”. Module blocks have the same behavior as object literals. Meaning each time a module block is evaluated, a new module block is created.

```js
const arr = new Array(2);
for(let i = 0; i < 2; i++) {
  arr[i] = module {};
}
console.assert(arr[0] !== arr[1]);
console.assert(await import(arr[0]) !== await import(arr[1]));
```

However, module blocks participate in the module map just like any other module. So every module block can only ever have one instance in the same realm.

```js
const m1 = module{};
const m2 = m1;
console.assert(await import(m1) === await import(m2));
```

### What about TypeScript?

We've heard concerns from the TypeScript team that it could be difficult to type access to the global object within a module blocks. Unfortunately, this is part of a bigger pattern with TypeScript:

It is notoriously difficult to define what kind of scope a TypeScript file should be executed in (Main thread vs worker vs service worker), which is often solved by having multiple `tsconfig.json` files and composited projects. In that scenario, it’s even harder to have code that is shared across these TS projects.

When communicating with a Worker, you already need to force a type on the `event.data` to bring typing to the communication channel.

All in all, it's hard to judge how much worse or more complicated Module Blocks makes the typing situation.

Nevertheless, we're thinking about this problem and in early discussions with the TypeScript team about possible solutions, such as a TS syntax for annotating the type of the global object for a module block, such as `module<GlobalInterface> { }`

### Should we really allow creation of workers using module blocks?

In my opinion: Yes. The requirement that workers are in a separate file is one of the most prominent pieces of feedback about why workers are hard to adopt. That’s why so many resort to Blob URLs or Data URLs, bringing along all kinds of difficulties, especially relating to paths and CSP. The risk here is that people start spawning a lot workers without regards to their cost, but I think the benefits of lowering the barrier to workers as an important performance primitive outweigh the risks. We have an [on-going discussion](https://github.com/tc39/proposal-js-module-blocks/issues/21) about this topic.

## Examples

### Greenlet

If you know [Jason Miller’s][developit] [Greenlet] (or my [Clooney]), Module Blocks would be the perfect building block for such off-main-thread scheduler libraries.

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
const workerBlock = module {
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
          .addModule(workerBlock)
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
[inline modules]: https://gist.github.com/justinfagnani/d26ba99aec5ffc02264907512c082622
[domenic denicola]: https://twitter.com/domenic
[surma]: https://twitter.com/dassurma
[shu]: https://twitter.com/_shu
[scheduler api]: https://github.com/WICG/main-thread-scheduling/
[blöcks]: https://github.com/domenic/proposal-blocks/tree/44668b647c48b116a8643d04e4e80735a3c5b78d
[js module bundles]: https://gist.github.com/littledan/c54efa928b7e6ce7e69190f73673e2a0
[greenlet]: https://github.com/developit/greenlet
[developit]: https://twitter.com/_developit
[clooney]: https://github.com/GoogleChromeLabs/clooney
[css painting api]: https://developer.mozilla.org/en-US/docs/Web/API/CSS_Painting_API
[web workers]: https://developer.mozilla.org/en-US/docs/Web/API/Worker
[separate files]: https://www.w3.org/2018/12/games-workshop/report.html#threads
[houdini bundler guidance]: https://houdini.how/usage
[unpkg.com]: https://unpkg.com
[paralleljs]: https://github.com/parallel-js/parallel.js
