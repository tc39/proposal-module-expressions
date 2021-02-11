const syntaxModuleBlocks = require("./babel/packages/babel-plugin-syntax-module-blocks");
const babel = require("./babel/packages/babel-core");

const moduleBlockTransform = {
  name: "transform-module-block",

  visitor:  {
    ModuleExpression(path) {
      const { scope } = path;
      return;
      const { scope } = path;
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
    },
  },
};

const ast = babel.transform(
  `const x = module { 
    export default function() {
      console.log("ohai!");
    };
  };
  import(x);`,
  {
    plugins: [syntaxModuleBlocks, moduleBlockTransform],
  }
);

// console.log(ast);
// console.log(ast.program.body[0].declarations[0].init);