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
        new Worker(workerModule, {type: "module", name: `worker${this.workersCreated}`})
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

export default async function greenlet(args, module) {
  const worker = await getWorker();
  worker.postMessage({ args, module });
  return new Promise((resolve) => {
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
}