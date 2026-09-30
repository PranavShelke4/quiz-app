// Deterministic, secret-free test environment.
Object.assign(process.env, {
  AUTH_SECRET: "test-auth-secret-test-auth-secret-0123456789",
  CRON_SECRET: "test-cron-secret-0123456789",
  ADMIN_SETUP_SECRET: "test-setup-secret-0123456789",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  MONGODB_URI: process.env.MONGODB_URI ?? "mongodb://unused-in-unit-tests",
  MONGODB_DB: "quiz_test",
});
