// Hygiene engine — a faithful port of evaluateHygiene / analyzeSprint
// from the backend's src/sprint-analyzer.ts, adapted to run on-device.

import { Finding, HygieneResult, Sprint, SprintMetrics, StoryGroup, Task } from './types';
import { healthGrades, rules } from './rulesConfig';

const DAY = 1000 * 60 * 60 * 24;

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.floor((now - new Date(iso).getTime()) / DAY);
}

const ruleById = (id: string) => rules.find((r) => r.id === id)!;

export function evaluateSprint(sprint: Sprint, now = Date.now()): HygieneResult {
  const findings: Finding[] = [];
  const tasks = sprint.tasks;
  const totalTasks = tasks.length || 1; // guard divide-by-zero

  const activeTasks = tasks.filter((t) => t.state === 'Active');
  const newTasks = tasks.filter((t) => t.state === 'New');
  const closedTasks = tasks.filter((t) => t.state === 'Closed');
  const removedTasks = tasks.filter((t) => t.state === 'Removed');

  // 1. WIP_LIMIT — active tasks per person
  const wip = ruleById('WIP_LIMIT');
  const personActive: Record<string, number> = {};
  activeTasks.forEach((t) => (personActive[t.assignedTo] = (personActive[t.assignedTo] ?? 0) + 1));
  for (const [person, count] of Object.entries(personActive)) {
    if (count >= wip.critical_threshold) {
      findings.push({
        ruleId: 'WIP_LIMIT',
        severity: 'CRITICAL',
        message: `${person} has ${count} active tasks`,
        details: `Exceeds critical threshold of ${wip.critical_threshold}. Context-switching and burnout risk.`,
      });
    } else if (count >= wip.warning_threshold) {
      findings.push({
        ruleId: 'WIP_LIMIT',
        severity: 'WARNING',
        message: `${person} has ${count} active tasks`,
        details: `Exceeds warning threshold of ${wip.warning_threshold} active tasks per person.`,
      });
    }
  }

  // 2. TASK_STALENESS — days since last change
  const stale = ruleById('TASK_STALENESS');
  const staleTasks = tasks
    .map((t) => ({ t, d: daysSince(t.changedDate, now) }))
    .filter(({ d }) => d !== null && d > stale.warning_threshold);
  const criticalStale = staleTasks.filter(({ d }) => (d ?? 0) > stale.critical_threshold);
  if (criticalStale.length > 0) {
    findings.push({
      ruleId: 'TASK_STALENESS',
      severity: 'CRITICAL',
      message: `${criticalStale.length} task(s) untouched for >${stale.critical_threshold} days`,
      details: criticalStale.slice(0, 6).map(({ t, d }) => `#${t.id}: ${t.title} (${d}d, ${t.state})`).join('\n'),
    });
  } else if (staleTasks.length > 0) {
    findings.push({
      ruleId: 'TASK_STALENESS',
      severity: 'WARNING',
      message: `${staleTasks.length} task(s) untouched for >${stale.warning_threshold} days`,
      details: staleTasks.slice(0, 6).map(({ t, d }) => `#${t.id}: ${t.title} (${d}d, ${t.state})`).join('\n'),
    });
  }

  // 3. UNASSIGNED_TASKS
  const unassignedRule = ruleById('UNASSIGNED_TASKS');
  const unassigned = tasks.filter((t) => t.assignedTo === 'Unassigned' && (t.state === 'Active' || t.state === 'New'));
  const unassignedPct = (unassigned.length / totalTasks) * 100;
  if (unassignedPct > unassignedRule.critical_threshold) {
    findings.push({
      ruleId: 'UNASSIGNED_TASKS',
      severity: 'CRITICAL',
      message: `${unassigned.length} unassigned task(s)`,
      details: `${unassignedPct.toFixed(1)}% of tasks have no owner. Every task must have a clear owner.`,
    });
  } else if (unassigned.length > unassignedRule.warning_threshold) {
    findings.push({
      ruleId: 'UNASSIGNED_TASKS',
      severity: 'WARNING',
      message: `${unassigned.length} unassigned task(s)`,
      details: `Without owners: ${unassigned.slice(0, 5).map((t) => `#${t.id}`).join(', ')}`,
    });
  }

  // 4. SPRINT_COMPLETION_RATE
  const completionRule = ruleById('SPRINT_COMPLETION_RATE');
  const completionPct = (closedTasks.length / totalTasks) * 100;
  if (completionPct < completionRule.critical_threshold) {
    findings.push({
      ruleId: 'SPRINT_COMPLETION_RATE',
      severity: 'CRITICAL',
      message: `Only ${completionPct.toFixed(1)}% of tasks completed`,
      details: `${closedTasks.length}/${tasks.length} closed. Sprint execution is severely behind.`,
    });
  } else if (completionPct < completionRule.warning_threshold) {
    findings.push({
      ruleId: 'SPRINT_COMPLETION_RATE',
      severity: 'WARNING',
      message: `Only ${completionPct.toFixed(1)}% of tasks completed`,
      details: `${closedTasks.length}/${tasks.length} closed. Sprint is at risk of missing goals.`,
    });
  }

  // 5. NEW_TASK_RATIO
  const newRule = ruleById('NEW_TASK_RATIO');
  const newTaskPct = (newTasks.length / totalTasks) * 100;
  if (newTaskPct > newRule.critical_threshold) {
    findings.push({
      ruleId: 'NEW_TASK_RATIO',
      severity: 'CRITICAL',
      message: `${newTaskPct.toFixed(1)}% of tasks still in New state`,
      details: `${newTasks.length}/${tasks.length} not started. Poor execution and lack of momentum.`,
    });
  } else if (newTaskPct > newRule.warning_threshold) {
    findings.push({
      ruleId: 'NEW_TASK_RATIO',
      severity: 'WARNING',
      message: `${newTaskPct.toFixed(1)}% of tasks still in New state`,
      details: `${newTasks.length}/${tasks.length} not started. Sprint needs to accelerate pickup.`,
    });
  }

  // 6. TASK_AGING_NEW
  const agingNew = ruleById('TASK_AGING_NEW');
  if (newTasks.length > 0) {
    const avg = newTasks.reduce((s, t) => s + (daysSince(t.createdDate, now) ?? 0), 0) / newTasks.length;
    if (avg > agingNew.critical_threshold) {
      findings.push({
        ruleId: 'TASK_AGING_NEW',
        severity: 'CRITICAL',
        message: `New tasks average ${avg.toFixed(1)} days unstarted`,
        details: `Threshold: ${agingNew.critical_threshold} days. Tasks are not being picked up.`,
      });
    } else if (avg > agingNew.warning_threshold) {
      findings.push({
        ruleId: 'TASK_AGING_NEW',
        severity: 'WARNING',
        message: `New tasks average ${avg.toFixed(1)} days unstarted`,
        details: `Threshold: ${agingNew.warning_threshold} days. Pick tasks up faster.`,
      });
    }
  }

  // 7. TASK_AGING_ACTIVE
  const agingActive = ruleById('TASK_AGING_ACTIVE');
  if (activeTasks.length > 0) {
    const avg = activeTasks.reduce((s, t) => s + (daysSince(t.changedDate, now) ?? 0), 0) / activeTasks.length;
    if (avg > agingActive.critical_threshold) {
      findings.push({
        ruleId: 'TASK_AGING_ACTIVE',
        severity: 'CRITICAL',
        message: `Active tasks average ${avg.toFixed(1)} days without progress`,
        details: `Threshold: ${agingActive.critical_threshold} days. Work is stalled or blocked.`,
      });
    } else if (avg > agingActive.warning_threshold) {
      findings.push({
        ruleId: 'TASK_AGING_ACTIVE',
        severity: 'WARNING',
        message: `Active tasks average ${avg.toFixed(1)} days without progress`,
        details: `Threshold: ${agingActive.warning_threshold} days. Tasks should complete faster.`,
      });
    }
  }

  // 8. UNCLEAR_TITLES
  const unclearRule = ruleById('UNCLEAR_TITLES');
  const patterns = (unclearRule.unclear_patterns ?? []).map((p) => p.toLowerCase());
  const unclear = tasks.filter((t) => patterns.some((p) => t.title.toLowerCase().includes(p)));
  const unclearPct = (unclear.length / totalTasks) * 100;
  if (unclearPct > unclearRule.critical_threshold) {
    findings.push({
      ruleId: 'UNCLEAR_TITLES',
      severity: 'CRITICAL',
      message: `${unclearPct.toFixed(1)}% of tasks have unclear titles`,
      details: unclear.slice(0, 5).map((t) => `#${t.id}: "${t.title}"`).join(', '),
    });
  } else if (unclearPct > unclearRule.warning_threshold) {
    findings.push({
      ruleId: 'UNCLEAR_TITLES',
      severity: 'WARNING',
      message: `${unclearPct.toFixed(1)}% of tasks have unclear titles`,
      details: unclear.slice(0, 5).map((t) => `#${t.id}: "${t.title}"`).join(', '),
    });
  }

  // 9. WORKLOAD_BALANCE + SINGLE_PERSON_DEPENDENCY
  const personTaskCounts: Record<string, number> = {};
  tasks.forEach((t) => (personTaskCounts[t.assignedTo] = (personTaskCounts[t.assignedTo] ?? 0) + 1));
  const people = Object.keys(personTaskCounts);
  if (people.length > 1) {
    const workload = ruleById('WORKLOAD_BALANCE');
    const avg = tasks.length / people.length;
    const overloaded = Object.entries(personTaskCounts).filter(
      ([, c]) => c > avg * (workload.warning_threshold_multiplier ?? 2),
    );
    const under = Object.entries(personTaskCounts).filter(
      ([, c]) => c < avg * (workload.underutilized_threshold_multiplier ?? 0.4),
    );
    if (overloaded.length > 0) {
      findings.push({
        ruleId: 'WORKLOAD_BALANCE',
        severity: 'WARNING',
        message: `${overloaded.length} team member(s) overloaded`,
        details: `${overloaded.map(([p, c]) => `${p}: ${c}`).join(', ')}. Average ${avg.toFixed(1)} tasks/person.`,
      });
    }
    if (under.length > 0) {
      findings.push({
        ruleId: 'WORKLOAD_BALANCE',
        severity: 'WARNING',
        message: `${under.length} team member(s) underutilized`,
        details: `${under.map(([p, c]) => `${p}: ${c}`).join(', ')}. Average ${avg.toFixed(1)} tasks/person.`,
      });
    }

    const single = ruleById('SINGLE_PERSON_DEPENDENCY');
    const maxLoad = Math.max(...Object.values(personTaskCounts));
    const maxPerson = Object.entries(personTaskCounts).find(([, c]) => c === maxLoad)?.[0];
    const share = (maxLoad / tasks.length) * 100;
    if (share > single.critical_threshold) {
      findings.push({
        ruleId: 'SINGLE_PERSON_DEPENDENCY',
        severity: 'CRITICAL',
        message: `${maxPerson} carries ${share.toFixed(1)}% of sprint tasks`,
        details: `${maxLoad}/${tasks.length} tasks. Bus-factor risk — overly dependent on one person.`,
      });
    } else if (share > single.warning_threshold) {
      findings.push({
        ruleId: 'SINGLE_PERSON_DEPENDENCY',
        severity: 'WARNING',
        message: `${maxPerson} carries ${share.toFixed(1)}% of sprint tasks`,
        details: `${maxLoad}/${tasks.length} tasks. Consider redistributing work.`,
      });
    }
  }

  // Grade
  const criticalIssues = findings.filter((f) => f.severity === 'CRITICAL').length;
  const warnings = findings.filter((f) => f.severity === 'WARNING').length;
  let grade = 'A';
  if (criticalIssues >= 3) grade = 'F';
  else if (criticalIssues >= 2 || warnings >= 10) grade = 'D';
  else if (criticalIssues >= 1 || warnings >= 5) grade = 'C';
  else if (warnings >= 3) grade = 'B';
  else grade = 'A';

  const metrics: SprintMetrics = {
    totalTasks: tasks.length,
    activeTasks: activeTasks.length,
    newTasks: newTasks.length,
    closedTasks: closedTasks.length,
    removedTasks: removedTasks.length,
    completionPct,
    newTaskPct,
    avgDaysInNew:
      newTasks.length > 0
        ? newTasks.reduce((s, t) => s + (daysSince(t.createdDate, now) ?? 0), 0) / newTasks.length
        : 0,
    avgDaysInActive:
      activeTasks.length > 0
        ? activeTasks.reduce((s, t) => s + (daysSince(t.changedDate, now) ?? 0), 0) / activeTasks.length
        : 0,
    personBreakdown: personTaskCounts,
  };

  return {
    grade,
    gradeLabel: healthGrades[grade].label,
    findings,
    metrics,
    criticalIssues,
    warnings,
    teamMembers: people.filter((p) => p !== 'Unassigned').length,
  };
}

// Group tasks under their parent story (mirrors the daily taskboard grouping).
export function groupByStory(tasks: Task[]): StoryGroup[] {
  const map = new Map<number | string, StoryGroup>();
  for (const t of tasks) {
    const key = t.parentId ?? `standalone-${t.id}`;
    if (!map.has(key)) {
      map.set(key, {
        storyId: t.parentId,
        storyTitle: t.parentTitle ?? t.title,
        tasks: [],
      });
    }
    map.get(key)!.tasks.push(t);
  }
  return Array.from(map.values()).sort((a, b) => a.storyTitle.localeCompare(b.storyTitle));
}
