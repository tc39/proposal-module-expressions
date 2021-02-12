# Sandbox

This is a sandbox that uses a [Babel] transform to shim Module Blocks. It is a web server that will automatically transform all `.js` files in the `static` folder. This allows you to play around with Module Blocks.

**WARNING:** The sandbox is not spec compliant and the transform should absolutely not be used outside of this folder. The JS spec for module blocks have not been reviewed, the spec for HTML hasn’t even been written yet. The behavior of module blocks in the sandbox will not accurately reflect what module blocks will look like in the end.

**WARNING:** This is a toy. I will close any and all bug reports, PRs and feature requests for the sandbox unless coordinated with me.

## Instructions

```
$ git submodule init
$ git submodule update
$ npm i
$ cd babel
# You *must* use yarn for babel, so make sure you have it installed.
$ yarn install
$ make build
$ cd ..
$ npm start
```

[babel]: https://babeljs.io/
