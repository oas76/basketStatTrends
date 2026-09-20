const { currentDriver } = require('../lib/storageDriver');

function clearStorageEnv() {
  delete process.env.STORAGE_DRIVER;
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
}

describe('currentDriver selection', () => {
  beforeEach(clearStorageEnv);
  afterAll(clearStorageEnv);

  test('defaults to file when nothing is configured', () => {
    expect(currentDriver()).toBe('file');
  });

  test('DATABASE_URL selects postgres', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@host/db';
    expect(currentDriver()).toBe('postgres');
  });

  test('VERCEL + blob token selects blob', () => {
    process.env.VERCEL = '1';
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_x';
    expect(currentDriver()).toBe('blob');
  });

  test('VERCEL without a blob token falls back to file', () => {
    process.env.VERCEL = '1';
    expect(currentDriver()).toBe('file');
  });

  test('postgres takes precedence over blob', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@host/db';
    process.env.VERCEL = '1';
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_x';
    expect(currentDriver()).toBe('postgres');
  });

  test('explicit STORAGE_DRIVER overrides everything', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@host/db';
    process.env.STORAGE_DRIVER = 'file';
    expect(currentDriver()).toBe('file');
  });

  test('invalid STORAGE_DRIVER is ignored', () => {
    process.env.STORAGE_DRIVER = 'nonsense';
    expect(currentDriver()).toBe('file');
  });
});
