import { getPropertyName, isTestLike, unwrapExpression } from "../utils.mjs";

/**
 * Runtime runners that leave the Effect world. Keep these at designated
 * boundary modules (see .oxlintrc.json overrides); everywhere else stay in
 * Effect and let the runtime / atom bridge drive execution.
 *
 * Note: executor's identically-named rule flags die/orDie. Multiplex's phase-0
 * rule targets runPromise/runSync/runFork/runPromiseExit per the migration plan.
 */
const escapeHatches = new Set(["runPromise", "runSync", "runFork", "runPromiseExit"]);

const message =
  "Do not call Effect.runPromise/runSync/runFork/runPromiseExit outside designated boundary files. Keep Effect values in the Effect world; run only at a narrow runtime edge. Skill: effect-typed-errors.";

const isEffectEscapeHatch = (node) => {
  const expression = unwrapExpression(node);
  if (expression?.type !== "MemberExpression") return false;
  const object = unwrapExpression(expression.object);
  if (object?.type !== "Identifier" || object.name !== "Effect") return false;
  const property = getPropertyName(expression.property);
  return escapeHatches.has(property);
};

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Effect.runPromise/runSync/runFork/runPromiseExit outside designated boundary files.",
    },
  },
  create(context) {
    if (isTestLike(context.filename)) return {};

    return {
      MemberExpression(node) {
        if (isEffectEscapeHatch(node)) {
          context.report({ node, message });
        }
      },
    };
  },
};
