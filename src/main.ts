import "#app/polyfills";

if (import.meta.env.DEV) {
  await import("./rust-browser/production/legacy-transition-main");
} else {
  const production = await import("./rust-browser/production/configured-production-main");
  try {
    await production.startConfiguredProductionMainV1();
  } catch (error) {
    production.renderProductionUnavailableV1(error);
  }
}
