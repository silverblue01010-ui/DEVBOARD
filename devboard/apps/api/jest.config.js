/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  moduleNameMapper: {
    "^@devboard/shared$": "<rootDir>/../../packages/shared/src/index.ts",
  },
};
