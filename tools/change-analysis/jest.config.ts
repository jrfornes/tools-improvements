/* eslint-disable */
module.exports = {
  displayName: 'change-analysis',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/tools/change-analysis',
  // The shared arg parser lives outside this project's root.
  roots: ['<rootDir>/src', '<rootDir>/../shared'],
};
