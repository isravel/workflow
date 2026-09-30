export const durationMinutesFromInput = (value: string) => {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  const compactHours = normalized.match(/^(\d+)h(\d+)$/);
  const match = normalized.match(/^(?:(\d+)h)?(?:(\d+)m)?$/);
  if (compactHours) return Number(compactHours[1]) * 60 + Number(compactHours[2]);
  if (!match || (!match[1] && !match[2])) return null;
  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  return minutes > 0 ? minutes : null;
};
