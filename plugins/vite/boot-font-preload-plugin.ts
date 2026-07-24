import type { Plugin as VitePlugin } from "vite";

const CRITICAL_FONTS = ["./fonts/pokemon-emerald-pro.ttf", "./fonts/pkmnems.ttf"] as const;

/** Inject critical font preloads only into builds that enable the staged boot path. */
export function bootFontPreloadPlugin(): VitePlugin {
  let enabled = false;

  return {
    name: "boot-font-preloads",
    configResolved(config): void {
      enabled = config.env.VITE_BOOT_OPTIMIZATIONS === "1";
    },
    transformIndexHtml() {
      if (!enabled) {
        return;
      }
      return CRITICAL_FONTS.map(href => ({
        tag: "link",
        attrs: { rel: "preload", as: "font", type: "font/ttf", crossorigin: "anonymous", href },
        injectTo: "head" as const,
      }));
    },
  };
}
