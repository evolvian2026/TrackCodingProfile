// Tests never touch a real platform.
process.env.DATA_SOURCE = 'mock';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.QUEUE_DRIVER = 'inline';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-value-not-for-production';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://tcp@127.0.0.1:5432/tcp_test?schema=public';
