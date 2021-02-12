const moduleBlock = module {
  import {shout} from "./utils.js";

  console.log(shout("Hello from a module block!"));
  console.log("import.meta.url = ", import.meta.url)

  import("./another_module.js").then((m) => console.log(m.default()));
};
import(moduleBlock);

new Worker(module {
  import {shout} from "./utils.js";
  console.log(shout("Hello from a worker!"), self);
}, {type: "module"})