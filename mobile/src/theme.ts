// Helpables brand palette (from the Helpables brand kit)
// Logo gradient: #24B3F5 (blue) -> #9AED47 (green) on deep teal #02292E
export const colors = {
  // Surfaces — dark-first
  bgDeep: '#02292E', // deep teal, app background
  bgNavy: '#151E2D', // navy, secondary surface
  card: '#0E353B', // raised card on the teal background
  cardAlt: '#10222F',
  border: '#1C4A52',

  // Brand
  brandBlue: '#24B3F5',
  brandGreen: '#9AED47',
  actionGreen: '#3ECF6E', // button green

  // Text
  text: '#EAF6F4',
  textMuted: '#8FB3B3',
  textFaint: '#5C8082',

  // Severity / grade semantics
  critical: '#FF5C5C',
  warning: '#F5B83D',
  good: '#3ECF6E',
  info: '#24B3F5',
};

// A–F health grade colour mapping
export const gradeColor = (grade: string): string => {
  switch (grade) {
    case 'A':
      return colors.good;
    case 'B':
      return colors.brandGreen;
    case 'C':
      return colors.warning;
    case 'D':
      return '#F59042';
    default:
      return colors.critical; // F
  }
};

// Taskboard lane colours (mirrors the email report's stateBadgeHtml)
export const laneColor = (lane: string): { bg: string; fg: string } => {
  switch (lane) {
    case 'To do':
      return { bg: '#13314A', fg: '#5BA9F0' };
    case 'In Progress':
      return { bg: '#3A2E10', fg: '#F5B83D' };
    case 'In Review':
      return { bg: '#2A1F45', fg: '#A78BFA' };
    case 'Completed':
      return { bg: '#0E3A2A', fg: '#3ECF6E' };
    case 'Blocked':
      return { bg: '#3A1414', fg: '#FF5C5C' };
    default:
      return { bg: '#1C2A30', fg: '#8FB3B3' };
  }
};
