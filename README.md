# Anonymous inline modules

Anonymous inline modules are an effort by [Daniel Ehrenberg] and [myself][surma]. It is the result of a lot of prior art, most notably [Justin Fagnani]’s [Inline Modules] proposal and [Domenic][domenic denicola]’s and [my][surma] [Blöcks] proposal.

## Problem space

The lack of inline modules in JavaScript has spawned some best practice that are really just workarounds and more often than not have negative performance implications. Sometimes, the lack of inline modules even form a hinderance to the adoption of APIs. A small sample of examples:

- Workers (and Worklets!) are often cited to be unergonomic because of the need of a separate file. Both Houdini and classic Web Workers can benefit greatly from inline modules.
- JavaScript cannot represent a “tasks” in a way that can be shared across realms, short of stringification.
- [Attempts][scheduler api] at building a scheduler for the web (á la GCD) have been constrained to the main thread due JS’s current inability to share code.

## High-level

Anonymous inline modules are syntax for the contents of a module, which can then be imported.

```js
let inlineModule = module {
  export let y = 1;
};
let moduleExports = await import(inlineModule);
assert(moduleExports.y === 1);

assert(await import(inlineModule) === moduleExports);  // cached in the module map
```

Importing an anonymous inline module needs to be async, as anonymous inline modules may import other modules, which are fetched from the network. Anonymous inline modules may get imported multiple times, but will get cached in the module map and will return a reference to the same module.

```js
let inlineModule = module {
  export * from "https://foo.com/script.mjs";
};
```

Anonymous inline modules are only imported through dynamic `import()`, and not through `import` statements, as there is no way to address them as a specifier string.

Relative import statements are resolved against with the path of the _declaring_ module. This is especially important when sending inline modules to a worker.

Anonymous modules can be turned into an Object URL using `URL.createObjectURL(inlineModule)` for backwards-compatibility. Maybe it even makes sense to allow stringification via `toString()`.

## Syntax details

```
PrimaryExpression :  InlineModuleExpression

InlineModuleExpression : module [no LineTerminator here] { Module }
```

As `module` is not a keyword in JavaScript, no newline is permitted between `module` and `{`. Probably this will be an easy bug to catch in practice, as accessing the variable `module` will usually be a ReferenceError.

## Realm interaction

As anonymous inline modules behave like module specifiers, they are independent of the Realm where they exist, and they cannot close over any lexically scoped variable outside of the module--they just close over the Realm in which they're imported.

For example, in conjunction with the [Realms proposal](https://github.com/tc39/proposal-realms), anonymous inline modules could permit syntactically local code to be executed in the context of the module:

```js
let module = module {
  export o = Object;
};

let m = await import(module);
assert(m.o === Object);

let r1 = new Realm();
let m1 = await r1.import(module);
assert(m1.o === r1.o);
assert(m1.o !== Object);

assert(m.o !== m1.o);
```

## Use with workers

It should be possible to run a module Worker with anonymous inline modules, and to `postMessage` an inline module to a worker:

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

Maybe it would be possible to store an inline module in IndexedDB as well, but this is more debatable, as persistent code could be a security risk.

## Integration with CSP

Content Security Policy (CSP) has two knobs which are relevant to anonymous inline modules

- Turning off `eval`, which also turns off other APIs which parse JavaScript. `eval` is disabled by default.
- Restricting the set of URLs allowed for sources, which also disables importing data URLs. By default, the set is unlimited.

Modules already allow the no-`eval` condition to be met: As modules are retrieved with `fetch`, they are not considered from `eval`, whether through `new Worker()` or `Realm.prototype.import`. Anonymous inline modules follow this: as they are parsed in syntax with the surrounding JavaScript code, they cannot be a vector for injection attacks, and they are not blocked by this condition.

The source list restriction is then applied to modules. The semantics of anonymous inline modules are basically equivalent to `data:` URLs, with the distinction that they would always be considered in the sources list (since it's part of a resource that was already loaded as script).

## Optimization potential

The hope would be that anonymous inline modules are just as optimizable as normal modules that are imported multiple times. For example, one hope would be that, in some engines, bytecode for an inline module only needs to be generated once, even as it's imported multiple times in different Realms. However, type feedback and JIT-optimized code should probably be maintained separately for each Realm where the inline module is imported, or one module's use would pollute another.

## Support in tools

Anonymous inline modules could be transpiled to either data URLs, or to a module in a separate file. Either transformation preserves semantics.

## Named modules and bundling.

This proposal only allows anonymous module definitions. We could permit a form like `module x { }` which would define a local variable (much like class declarations), but this proposal omits it to avoid the risk that it be misinterpreted as defining a specifier that can be imported as a string form.

In its current form, this proposal is not suitable as a target for bundlers as modules can’t refer to or import each other. A complementary "named inline modules" proposal could do so. Note that there are significant privacy issues to solve with bundling to permit ad blockers; see [concerns from Brave](https://brave.com/webbundles-harmful-to-content-blocking-security-tools-and-the-open-web/).

[justin fagnani]: https://twitter.com/justinfagnani
[daniel ehrenberg]: https://twitter.com/littledan
[inline modules]: https://gist.github.com/justinfagnani/d26ba99aec5ffc02264907512c082622
[domenic denicola]: https://twitter.com/domenic
[surma]: https://twitter.com/dassurma
[shu]: https://twitter.com/_shu
[scheduler api]: https://github.com/WICG/main-thread-scheduling/
[blöcks]: https://github.com/domenic/proposal-blocks/tree/44668b647c48b116a8643d04e4e80735a3c5b78d
