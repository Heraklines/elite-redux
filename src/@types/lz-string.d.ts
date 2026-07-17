// Ambient declaration for `lz-string` (the package ships no bundled type declarations).
// Used at runtime by the co-op replay/snapshot compression path (compressToBase64 /
// decompressFromBase64). Declared as an untyped module so existing call sites that treat
// the decompressed result as a string are unaffected.
declare module "lz-string";
