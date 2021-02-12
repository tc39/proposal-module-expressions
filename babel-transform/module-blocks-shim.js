export class ModuleBlock {
  constructor(body) {
    this._body = body;
    this._blobURL = URL.createObjectURL(
      new Blob([body], { type: "text/javascript" })
    );
  }
  toString() {
    return `module {${this._body}}`;
  }
  [Symbol.toPrimitive]() {
    return this._blobURL;
  }
}

self.ModuleBlock = ModuleBlock;
