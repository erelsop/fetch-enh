module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/types/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'json-summary', 'html'],
  coverageThreshold: {
    global: {
      // Targets are intentionally higher than the original 70/80/80/80 floor.
      // functions is capped at 83 because browser-only branches in BasicAuth,
      // inner callbacks in _fetchAndParse, and pagination helpers cannot be
      // exercised from Node-based Jest; raise toward 85/90 when those paths
      // gain dedicated test coverage.
      branches: 80,
      functions: 83,
      lines: 90,
      statements: 90,
    },
  },
};
