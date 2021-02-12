import Express from "express";
import { readFile } from "fs/promises";
import { transform } from "./module-block-transformer.js";

const staticDir = new URL("./static/", import.meta.url);
const app = Express();

app.get("/module-blocks-shim.js", async (req, res) => {
  res.set("Content-Type", "text/javascript");
  res.end(await readFile("./module-blocks-shim.js", "utf8"));
});

app.use(async (req, res, next) => {
  const asset = new URL(req.url.slice(1), staticDir).pathname;
  if (!asset.endsWith(".js")) {
    return next();
  }
  const contents = await readFile(asset, "utf8");
  res.set("Content-Type", "text/javascript");
  const transformedContents = transform(contents);
  console.log({ transformedContents });
  res.end(transformedContents);
});

app.use(Express.static("static"));

app.listen(8080, () => console.log("Listening on :8080"));
