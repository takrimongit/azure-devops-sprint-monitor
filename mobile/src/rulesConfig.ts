// Sprint hygiene rules — mirrors rules/sprint-hygiene-rules.json from the backend.
// Kept as a typed in-app constant so the engine runs fully offline on-device.

export interface HygieneRule {
  id: string;
  name: string;
  warning_threshold: number;
  critical_threshold: number;
  warning_threshold_multiplier?: number;
  underutilized_threshold_multiplier?: number;
  unclear_patterns?: string[];
}

export const rules: HygieneRule[] = [
  { id: 'WIP_LIMIT', name: 'Work In Progress Limit', warning_threshold: 2, critical_threshold: 3 },
  { id: 'TASK_STALENESS', name: 'Task Staleness', warning_threshold: 3, critical_threshold: 5 },
  { id: 'UNASSIGNED_TASKS', name: 'Unassigned Tasks', warning_threshold: 0, critical_threshold: 10 },
  { id: 'SPRINT_COMPLETION_RATE', name: 'Sprint Completion Rate', warning_threshold: 40, critical_threshold: 20 },
  { id: 'NEW_TASK_RATIO', name: 'Excessive New/Unstarted Tasks', warning_threshold: 50, critical_threshold: 70 },
  {
    id: 'WORKLOAD_BALANCE',
    name: 'Workload Balance',
    warning_threshold: 0,
    critical_threshold: 0,
    warning_threshold_multiplier: 2.0,
    underutilized_threshold_multiplier: 0.4,
  },
  { id: 'TASK_AGING_NEW', name: 'Task Aging (New State)', warning_threshold: 3, critical_threshold: 7 },
  { id: 'TASK_AGING_ACTIVE', name: 'Task Aging (Active State)', warning_threshold: 5, critical_threshold: 10 },
  {
    id: 'UNCLEAR_TITLES',
    name: 'Unclear Task Titles',
    warning_threshold: 5,
    critical_threshold: 15,
    unclear_patterns: ['TBD', 'TODO', 'Fix bugs', 'Update', 'Change', 'WIP', 'Misc', 'Other', 'Stuff', 'Things'],
  },
  { id: 'SPRINT_SCOPE_CREEP', name: 'Scope Creep', warning_threshold: 10, critical_threshold: 25 },
  { id: 'SINGLE_PERSON_DEPENDENCY', name: 'Single Person Dependency', warning_threshold: 40, critical_threshold: 55 },
];

export const healthGrades: Record<string, { label: string }> = {
  A: { label: 'A — Excellent' },
  B: { label: 'B — Good' },
  C: { label: 'C — Needs Improvement' },
  D: { label: 'D — Poor' },
  F: { label: 'F — Failing' },
};
