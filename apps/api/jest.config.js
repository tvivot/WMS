/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Red de seguridad: si un futuro test de integración deja un handle abierto
  // (timer @Interval, conexión Prisma, socket), detectOpenHandles lo reporta y
  // forceExit evita que el runner quede colgado al terminar la suite.
  detectOpenHandles: true,
  forceExit: true,
};
