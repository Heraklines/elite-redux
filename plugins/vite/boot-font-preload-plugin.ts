import type { HtmlTagDescriptor, Plugin as VitePlugin } from "vite";

const CRITICAL_FONTS = ["./fonts/pokemon-emerald-pro.ttf", "./fonts/pkmnems.ttf"] as const;

const BOOT_LOADER_CSS = `
#er-boot-loader {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: grid;
  place-content: center;
  gap: 14px;
  background: #111318;
  color: #fff;
  font-family: emerald, monospace;
  text-align: center;
  pointer-events: none;
}
#er-boot-loader-track {
  width: min(68vw, 640px);
  height: 24px;
  overflow: hidden;
  border: 4px solid #da3838;
  background: #222;
}
#er-boot-loader-fill {
  width: 35%;
  height: 100%;
  background: #fff;
  animation: er-boot-loader-slide 1.1s linear infinite;
}
#er-boot-loader-label { font-size: 28px; }
@keyframes er-boot-loader-slide {
  from { transform: translateX(-100%); }
  to { transform: translateX(286%); }
}
@media (prefers-reduced-motion: reduce) {
  #er-boot-loader-fill { animation-duration: 2.5s; }
}
`;

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
      const tags: HtmlTagDescriptor[] = CRITICAL_FONTS.map(href => ({
        tag: "link",
        attrs: { rel: "preload", as: "font", type: "font/ttf", crossorigin: "anonymous", href },
        injectTo: "head" as const,
      }));
      tags.push(
        { tag: "style", children: BOOT_LOADER_CSS, injectTo: "head" },
        {
          tag: "div",
          attrs: { id: "er-boot-loader", role: "status", "aria-label": "Loading game" },
          children:
            '<div id="er-boot-loader-track"><div id="er-boot-loader-fill"></div></div><div id="er-boot-loader-label">Loading...</div>',
          injectTo: "body-prepend",
        },
      );
      return tags;
    },
  };
}
