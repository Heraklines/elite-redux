/*
 * Dev-only loader for the Shiny Lab harness: maps the repo's `#<dir>/*`
 * tsconfig path aliases onto real files so node --experimental-strip-types can
 * import the production modules directly. Registered via --import; never
 * referenced by the game or the build.
 */
import { resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("#")) {
    const rest = specifier.slice(1);
    const slash = rest.indexOf("/");
    const top = slash === -1 ? rest : rest.slice(0, slash);
    const tail = slash === -1 ? "" : rest.slice(slash + 1);
    // tsconfig: "#app/*" -> "./src/*.ts" (top segment is NOT a directory);
    //            "#data/*" -> "./src/data/*.ts" (and deeper fallbacks the lab
    //            harness never hits).
    const rel = top === "app" ? `${tail}.ts` : `${top}/${tail}.ts`;
    const target = pathResolve(ROOT, "src", rel);
    return nextResolve(pathToFileURL(target).href, context);
  }
  return nextResolve(specifier, context);
}
