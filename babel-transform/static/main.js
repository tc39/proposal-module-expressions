const moduleBlock = module {
  import {shout} from "./utils.js";

  console.log(shout("Hello from a module block!"));
  console.log("import.meta.url = ", import.meta.url)

  import("./another_module.js").then((m) => console.log(m.default()));
};
import(moduleBlock);

const taskWorker = new Worker(module {
  import {shout} from "./utils.js";
  console.log(shout("Hello from a worker!"), self);
  addEventListener("message", async ({data}) => {
    const {task, parameters} = data;
    const {main} = await import(task);
    postMessage(await main(...parameters));
  });
}, {type: "module"});

taskWorker.postMessage({
  task: module {
    export async function main(a, b) {
      return a + b;
    }
  },
  parameters: [40, 2]
});
taskWorker.addEventListener("message", ({data}) => {
  console.log("Received a result:", data);
});