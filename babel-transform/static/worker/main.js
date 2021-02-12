const worker = new Worker(module {
  console.log("Hello from a worker!");
  addEventListener("message", async ({data}) => {
    const m = await import(data);
    await m.default();
  });
}, {type: "module"});

worker.postMessage(module {
  export default function() {
    console.log("Message from the main thread", self);
    console.log("import.meta.url = ", import.meta.url);
  }
});
