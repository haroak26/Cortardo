export function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfD = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.floor((startOfToday - startOfD) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatFullDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dayBucketLabel(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfD = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.floor((startOfToday - startOfD) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return 'Everything else';
}

export function displayName(fromName: string | null, fromAddress: string) {
  if (!fromName || fromName === fromAddress) {
    const local = fromAddress.split('@')[0] ?? fromAddress;
    return local.replace(/[._+-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  return fromName;
}

export function compactSenderName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${firstName} ${lastInitial}`;
}
