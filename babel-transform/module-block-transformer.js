import _generate from "./babel/packages/babel-generator/lib/index.js";
import _traverse from "./babel/packages/babel-traverse/lib/index.js";
import syntaxModuleBlocks from "./babel/packages/babel-plugin-syntax-module-blocks/lib/index.js";
import babel from "./babel/packages/babel-core/lib/index.js";

const generate = _generate.default;
const traverse = _traverse.default;

function isLocalFilePath(modulePath) {
  if (typeof modulePath !== "string") {
    return false;
  }
  return (
    modulePath.startsWith("/") ||
    modulePath.startsWith("./") ||
    modulePath.startsWith("../")
  );
}

function moduleBlockTransform({ types: t }) {
  function taggedTemplate(quasis, exprs) {
    return t.templateLiteral(
      quasis.map((raw, i, arr) =>
        t.templateElement({ raw, tail: i + 1 == arr.length })
      ),
      exprs
    );
  }

  function moduleBlockBlob(taggedTemplateBody) {
    return t.newExpression(t.identifier("ModuleBlock"), [taggedTemplateBody]);
  }

  function urlPattern(path) {
    const ast = babel.parse(
      `new URL(${JSON.stringify(path)}, import.meta.url)`
    );
    return ast.program.body[0].expression;
  }

  return {
    name: "transform-module-block",

    visitor: {
      Program: {
        exit(path) {
          path.unshiftContainer(
            "body",
            t.importDeclaration(
              [
                t.importSpecifier(
                  t.identifier("ModuleBlock"),
                  t.identifier("ModuleBlock")
                ),
              ],
              t.stringLiteral("/module-blocks-shim.js")
            )
          );
        },
      },
      Import(path) {
        if (path.parent.arguments.length != 1) {
          // Wat are you doing?!
          return;
        }
        const parameter = path.parent.arguments[0];
        if (
          parameter.type === "StringLiteral" &&
          isLocalFilePath(parameter.value)
        ) {
          const newUrl = urlPattern(parameter.value);
          path.parentPath.get("arguments.0").replaceWith(newUrl);
          return;
        }
        path.parentPath
          .get("arguments.0")
          .replaceWith(
            t.callExpression(
              t.memberExpression(
                t.identifier("ModuleBlock"),
                t.identifier("fixup")
              ),
              [parameter]
            )
          );
      },
      ModuleExpression(path) {
        const { node } = path;
        let { code: stringifiedBody } = generate(node.body);
        stringifiedBody = transform(stringifiedBody);
        const body = babel.parse(stringifiedBody, {
          plugins: [syntaxModuleBlocks],
        });
        // `splits` will contain all the parts that need to get split out
        // of the template string literal and need special handling.
        // These cases are:
        // - import.meta.url: To inherit import.meta.url value from the surrounding module
        // - static imports: turn `import "./x.js"` into `import "${new URL("./x.js", import.meta.url)}"`
        // - something around dynamic import maybe
        // - maybe even more but idk
        let splits = [];
        traverse(body, {
          MemberExpression(path) {
            // We only care about import.meta.XXX
            if (path.node.object.type !== "MetaProperty") {
              return;
            }
            splits.push({
              type: "meta",
              start: path.node.start,
              end: path.node.end,
            });
          },
          ImportDeclaration(path) {
            const modulePath = path.node.source.value;
            if (!isLocalFilePath(modulePath)) {
              return;
            }
            splits.push({
              type: "static-import",
              start: path.node.source.start,
              end: path.node.source.end,
            });
          },
        });
        // Sort *descending*
        splits.sort((a, b) => b.start - a.start);
        let remainder = stringifiedBody;
        const quasis = [];
        const exprs = [];
        for (const { type, start, end } of splits) {
          const snippet = remainder.slice(start, end);
          quasis.unshift(remainder.slice(end));
          remainder = remainder.slice(0, start);
          switch (type) {
            case "static-import":
              exprs.unshift(
                t.callExpression(
                  t.memberExpression(
                    t.identifier("JSON"),
                    t.identifier("stringify")
                  ),
                  [urlPattern(snippet.slice(1, -1))]
                )
              );
              break;
            case "meta":
              exprs.unshift(
                babel.parse("JSON.stringify(import.meta.url)").program.body[0]
                  .expression
              );
              break;
            default:
              throw Error(`Unknown split type ${JSON.stringify(type)}`);
          }
        }
        quasis.unshift(remainder);
        const taggedTemplateBody = taggedTemplate(quasis, exprs);
        const blob = moduleBlockBlob(taggedTemplateBody);
        path.replaceWith(blob);
      },
    },
  };
}

export function transform(source) {
  return babel.transform(source, {
    plugins: [syntaxModuleBlocks, moduleBlockTransform],
  }).code;
}
