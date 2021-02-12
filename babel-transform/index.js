const { default: generate } = require("./babel/packages/babel-generator");
const { default: traverse } = require("./babel/packages/babel-traverse");
const syntaxModuleBlocks = require("./babel/packages/babel-plugin-syntax-module-blocks");
const babel = require("./babel/packages/babel-core");

const source = `
  const x = module { 
    import {setModuleBlockPrototypeIfAppropriate} from "/module-block-helper.js";

    export default function() {
      console.log(import.meta.url);
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
        const quasis = [remainder];
        const exprs = [];
        // for(const {type, start, end} of splits) {
        //   const snippet = remainder.slice(start, end);
        //   quasis.unshift(remainder.slice(end))
        //   remainder = remainder.slice(0, start);
        //   exprs.unshift()
        // }
        // quasis.unshift(remainder);
        const taggedTemplateBody = taggedTemplate(quasis, exprs);
        const blob = moduleBlockBlob(taggedTemplateBody);
        path.replaceWith(blob);

        // traverse(body, {
        //   ImportDeclaration({node}) {
        //     start = node.source.start;
        //     end = node.source.end;
        //   }
        // });
        // console.log(`|${stringifiedBody}|`);
        // console.log(stringifiedBody.slice(start, end));
        /*
      // const { scope } = path;
      const { left, right, await: isAwait } = path.node;
      if (isAwait) {
        return;
      }
      const i = scope.generateUidIdentifier("i");
      let array = scope.maybeGenerateMemoised(right, true);

      const inits = [t.variableDeclarator(i, t.numericLiteral(0))];
      if (array) {
        inits.push(t.variableDeclarator(array, right));
      } else {
        array = right;
      }

      const item = t.memberExpression(
        t.cloneNode(array),
        t.cloneNode(i),
        true,
      );
      let assignment;
      if (t.isVariableDeclaration(left)) {
        assignment = left;
        assignment.declarations[0].init = item;
      } else {
        assignment = t.expressionStatement(
          t.assignmentExpression("=", left, item),
        );
      }

      let blockBody;
      const body = path.get("body");
      if (
        body.isBlockStatement() &&
        Object.keys(path.getBindingIdentifiers()).some(id =>
          body.scope.hasOwnBinding(id),
        )
      ) {
        blockBody = t.blockStatement([assignment, body.node]);
      } else {
        blockBody = t.toBlock(body.node);
        blockBody.body.unshift(assignment);
      }

      path.replaceWith(
        t.forStatement(
          t.variableDeclaration("let", inits),
          t.binaryExpression(
            "<",
            t.cloneNode(i),
            t.memberExpression(t.cloneNode(array), t.identifier("length")),
          ),
          t.updateExpression("++", t.cloneNode(i)),
          blockBody,
        ),
      );
    */
      },
    },
  };
}

const ast = babel.transform(source, {
  plugins: [syntaxModuleBlocks, moduleBlockTransform],
});
console.log(ast.code);
// console.log(generate(ast));
// console.log(ast);
// console.log(ast.program.body[0].declarations[0].init);
