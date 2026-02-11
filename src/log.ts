const tag = (level: string) =>
  `[${new Date().toISOString()}] [${level}]`;

export const log = {
  info: (...args: unknown[]) => console.error(tag("INFO"), ...args),
  warn: (...args: unknown[]) => console.error(tag("WARN"), ...args),
  error: (...args: unknown[]) => console.error(tag("ERROR"), ...args),
};
