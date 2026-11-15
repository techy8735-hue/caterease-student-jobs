// Start the compiled site and API with secure production cookie settings.
process.env.NODE_ENV = 'production';
await import('./index.mjs');
