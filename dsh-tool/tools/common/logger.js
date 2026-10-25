// dsh-tool/tools/common/logger.js
// Structured logger for tool executions inside dsh-tool sandbox

export function log(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    role: process.env.DSH_ROLE || 'user',
    user: process.env.DSH_USERNAME || 'unknown',
    message,
    ...meta
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}
