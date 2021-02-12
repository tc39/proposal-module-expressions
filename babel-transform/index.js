const { default: generate } = require("./babel/packages/babel-generator");
const { default: traverse } = require("./babel/packages/babel-traverse");
const syntaxModuleBlocks = require("./babel/packages/babel-plugin-syntax-module-blocks");
const babel = require("./babel/packages/babel-core");

const source = `
  const x = module { 
    import {uuid} from "./utils.js";

    export default function() {
      console.log(import.meta.url);
      console.log(uuid());
    };
  };
  import(x);
`;

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
    const blobUrlAst = babel.parse(
      `URL.createObjectURL(new Blob([\`\`], {type: "text/javascript"}));`
    );
    traverse(blobUrlAst, {
      TemplateLiteral(path) {
        path.replaceWith(taggedTemplateBody);
      },
    });
    return blobUrlAst.program.body[0];
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
      ModuleExpression(path) {
        const { node } = path;
        let { body } = node;
        const { code: stringifiedBody } = generate(body);

        // Re-parsing the stringified body. Why? Because I need to do replacements
        // and the .start/.end props from the original `body` don’t line up
        // and I can’t get them to line up. Sue me.
        body = babel.parse(stringifiedBody, { plugins: [syntaxModuleBlocks] });
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
            if (
              !modulePath.startsWith("/") &&
              modulePath.startsWith("./") &&
              modulePath.startsWith("../")
            ) {
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
              exprs.unshift(urlPattern(snippet.slice(1, -1)));
              break;
            case "meta":
              exprs.unshift(
                babel.parse("import.meta.url").program.body[0].expression
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

const ast = babel.transform(source, {
  plugins: [syntaxModuleBlocks, moduleBlockTransform],
});
console.log(ast.code);
