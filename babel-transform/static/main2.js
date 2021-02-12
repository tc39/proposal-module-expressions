import greenlet from "./new-greenlet.js";

greenlet([40, 2], module {
  export default async function main(a, b) {
    return a + b;
  }
}).then(result => console.log({result}));