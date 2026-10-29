/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // `scripts/` enthält das Build-Skript des BLS-Katalogs samt seinen Tests (#154).
  roots: ['<rootDir>/src', '<rootDir>/scripts'],
  // Reanimated und Worklets laufen im Test mit ihrer Web-Implementierung (#182). Der Resolver des
  // Presets entfernt nur `exports` von react-native über `packageFilter`, das Jest 30 nicht mehr kennt.
  resolver: 'react-native-reanimated/jest/resolver',
  setupFilesAfterEnv: ['<rootDir>/jest/setup.js'],
};
