export const activityColorOptions = [
  { token: "grey-600", label: "Grey" },
  { token: "ngrey-600", label: "Neutral grey" },
  { token: "red-600", label: "Red" },
  { token: "orange-600", label: "Orange" },
  { token: "yellow-600", label: "Yellow" },
  { token: "lime-600", label: "Lime" },
  { token: "green-600", label: "Green" },
  { token: "cyan-600", label: "Cyan" },
  { token: "blue-600", label: "Blue" },
  { token: "indigo-600", label: "Indigo" },
  { token: "violet-600", label: "Violet" },
  { token: "pink-600", label: "Pink" },
  { token: "jade-600", label: "Jade" },
  { token: "cherry-600", label: "Cherry" },
  { token: "amber-600", label: "Amber" },
  { token: "brown-600", label: "Brown" },
] as const;

export type ActivityColorToken = (typeof activityColorOptions)[number]["token"];

export const isActivityColorToken = (value: unknown): value is ActivityColorToken =>
  typeof value === "string"
  && activityColorOptions.some((option) => option.token === value);
