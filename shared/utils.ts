const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateTicketId(): string {
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += CHARS[Math.floor(Math.random() * 36)];
  }
  return result;
}
