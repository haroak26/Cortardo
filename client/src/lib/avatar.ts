export function gravatarUrl(email: string) {
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(email.trim().toLowerCase())}&backgroundColor=3b5bdb,0ea5e9,059669,d97706,dc2626&backgroundType=solid&fontSize=38&fontWeight=600`;
}
