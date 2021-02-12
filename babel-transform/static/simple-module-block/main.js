const moduleBlock = module {
  console.log("Hello from a module block!");
  console.log("import.meta.url = ", import.meta.url);
};
import(moduleBlock);
