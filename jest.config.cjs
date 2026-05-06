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
      // Raise branches toward 85 and functions toward 90 as new tests are added
      // for the remaining uncovered paths (e.g. browser-only branches in BasicAuth,
      // inner callbacks in _fetchAndParse, and pagination edge cases).
      branches: 80,
      functions: 85,
      lines: 90,
      statements: 90,
    },
  },
};
