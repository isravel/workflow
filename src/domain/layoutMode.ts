export type LayoutMode = "mobile" | "tablet" | "desktop";

export const responsiveBreakpoints = {
  tablet: 720,
  desktop: 1100,
} as const;

export const layoutModeForWidth = (
  width: number,
  tabletBreakpoint = responsiveBreakpoints.tablet,
  desktopBreakpoint = responsiveBreakpoints.desktop,
): LayoutMode => {
  if (width < tabletBreakpoint) return "mobile";
  if (width < desktopBreakpoint) return "tablet";
  return "desktop";
};

export const timelineLaneCapForMode: Record<LayoutMode, number> = {
  mobile: 3,
  tablet: 4,
  desktop: 6,
};
