export function createLogger() {
  return {
    info(fields, message) {
      write("info", fields, message);
    },
    warn(fields, message) {
      write("warn", fields, message);
    },
    error(fields, message) {
      write("error", fields, message);
    }
  };
}

function write(level, fields, message) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...(fields || {}) });
  (level === "error" ? console.error : console.log)(line);
}
