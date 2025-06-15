/** @type {import('ts-jest').JestConfigWithTsJest} **/
export default {
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['js', 'ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)?$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
