import noEffectEscapeHatch from "./oxlint-plugin-multiplex/rules/no-effect-escape-hatch.mjs";

export default {
  meta: {
    name: "multiplex",
  },
  rules: {
    "no-effect-escape-hatch": noEffectEscapeHatch,
  },
};
