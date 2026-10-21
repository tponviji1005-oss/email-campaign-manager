const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnv } = require('../src/config/validateEnv');

describe('Environment Validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('validateEnv throws clear actionable error when required variable is missing', () => {
    delete process.env.DATABASE_URL;
    assert.throws(
      () => validateEnv(),
      /Missing required environment variable: DATABASE_URL/
    );
  });

  test('validateEnv throws when SESSION_SECRET is too short', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.BREVO_WEBHOOK_TOKEN = 'token';
    process.env.SESSION_SECRET = 'short';
    assert.throws(
      () => validateEnv(),
      /SESSION_SECRET must be at least 32 characters/
    );
  });

  test('validateEnv throws when EMAIL_PROVIDER is invalid', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.BREVO_WEBHOOK_TOKEN = 'token';
    process.env.SESSION_SECRET = '12345678901234567890123456789012';
    process.env.EMAIL_PROVIDER = 'unsupported_provider';
    assert.throws(
      () => validateEnv(),
      /Invalid EMAIL_PROVIDER "unsupported_provider"/
    );
  });

  test('validateEnv throws when Brevo provider key starts with SMTP prefix xsmtpsib-', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.BREVO_WEBHOOK_TOKEN = 'token';
    process.env.SESSION_SECRET = '12345678901234567890123456789012';
    process.env.EMAIL_PROVIDER = 'brevo';
    process.env.BREVO_API_KEY = 'xsmtpsib-invalid-api-key';
    process.env.BREVO_SENDER_EMAIL = 'valid@example.com';
    assert.throws(
      () => validateEnv(),
      /BREVO_API_KEY appears to be an SMTP key/
    );
  });
});
