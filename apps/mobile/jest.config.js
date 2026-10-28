/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // `scripts/` enthält das Build-Skript des BLS-Katalogs samt seinen Tests (#154).
  roots: ['<rootDir>/src', '<rootDir>/scripts'],
};
