// Types ported from the azure-devops-sprint-monitor backend (src/sprint-analyzer.ts)

export type Severity = 'CRITICAL' | 'WARNING';

export interface Task {
  id: number;
  title: string;
  state: string; // raw WIT state: New / Active / Closed / Removed
  lane: string; // taskboard lane: To do / In Progress / In Review / Completed / Blocked
  assignedTo: string;
  iterationPath: string;
  parentId: number | null;
  parentTitle: string | null;
  changedDate: string | null; // ISO
  createdDate: string | null; // ISO
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  details: string;
}

export interface SprintMetrics {
  totalTasks: number;
  activeTasks: number;
  newTasks: number;
  closedTasks: number;
  removedTasks: number;
  completionPct: number;
  newTaskPct: number;
  avgDaysInNew: number;
  avgDaysInActive: number;
  personBreakdown: Record<string, number>;
}

export interface Sprint {
  name: string;
  startDate: string | null;
  endDate: string | null;
  tasks: Task[];
}

export interface HygieneResult {
  grade: string;
  gradeLabel: string;
  findings: Finding[];
  metrics: SprintMetrics;
  criticalIssues: number;
  warnings: number;
  teamMembers: number;
}

export interface StoryGroup {
  storyId: number | null;
  storyTitle: string;
  tasks: Task[];
}
