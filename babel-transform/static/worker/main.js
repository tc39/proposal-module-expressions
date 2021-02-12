const worker = new Worker(module {
  console.log("Hello from a worker!");
  addEventListener("message", ({data}) => {
    console.log("Got a message: ", data);
  });
}, {type: "module"});
worker.postMessage("Ohai from the main thread!")
