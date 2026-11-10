// В тестах и при проверке время подменяется через переменную NOW
export function now(): Date {
  return process.env.NOW ? new Date(process.env.NOW) : new Date();
}
