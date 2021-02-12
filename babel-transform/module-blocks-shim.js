const secretMarker = "___thisIsAModuleBlock";
export class ModuleBlock {
  constructor(body) {
    if (typeof body === "string") {
      this._body = body;
      this._blobURL = URL.createObjectURL(
        new Blob([body], { type: "text/javascript" })
      );
      return;
    }

    throw Error("Unexpected parameter type");
  }
  toString() {
    return `module {${this._body}}`;
  }
  static fixup(obj) {
    if (typeof obj !== "object") {
      return obj;
    }
    if (!(secretMarker in obj)) {
      return obj;
    }
    Object.setPrototypeOf(obj, ModuleBlock.prototype);
    return obj;
  }
  [Symbol.toPrimitive]() {
    return this._blobURL;
  }
}

self.ModuleBlock = ModuleBlock;
