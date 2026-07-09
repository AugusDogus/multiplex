import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function toRepoRelative(filename) {
  return path.relative(repoRoot, path.resolve(filename)).split(path.sep).join("/");
}

export function isTestLike(filename) {
  const normalized = toRepoRelative(filename);
  return (
    /(\.|\/)(test|spec|e2e|node\.test)\.tsx?$/.test(normalized) ||
    normalized.startsWith("tests/") ||
    normalized.includes("/e2e/")
  );
}

export function unwrapExpression(node) {
  let current = node;
  while (
    current?.type === "ChainExpression" ||
    current?.type === "ParenthesizedExpression" ||
    current?.type === "TSNonNullExpression" ||
    current?.type === "TSAsExpression" ||
    current?.type === "TSTypeAssertion"
  ) {
    current = current.expression;
  }
  return current;
}

export function getPropertyName(node) {
  if (!node) return undefined;
  if (node.type === "Identifier") return node.name;
  if (node.type === "PrivateIdentifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "StringLiteral") return node.value;
  return undefined;
}
