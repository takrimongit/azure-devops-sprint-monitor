import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import OpenAI from "openai";
import nodemailer from "nodemailer";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();
// Also try to load from Hermes env
const hermesEnvPath = path.join(process.env.HOME ?? "~", ".hermes", ".env");
if (fs.existsSync(hermesEnvPath)) {
  const hermesEnv = fs.readFileSync(hermesEnvPath, "utf-8");
  hermesEnv.split("\n").forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  });
}

// ============================================================
// TYPES
// ============================================================
interface Task {
  id: number;
  title: string;
  state: string;
  assignedTo: string;
  iterationPath: string;
  changedDate: Date | null;
  createdDate: Date | null;
  daysSinceChange: number | null;
  daysSinceCreated: number | null;
}

interface SerializedTask {
  id: number;
  title: string;
  state: string;
  assignedTo: string;
  iterationPath: string;
  changedDate: string | null;
  createdDate: string | null;
  daysSinceChange: number | null;
}

interface SprintMetrics {
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

interface Sprint {
  name: string;
  tasks: Task[];
  stateCounts: Record<string, number>;
  latestActivity?: Date | null;
  metrics?: SprintMetrics;
}

interface Person {
  name: string;
  taskCount: number;
  activeTasks: number;
  newTasks: number;
}

interface SprintData {
  tasks: SerializedTask[];
  sprints: Sprint[];
  currentSprint: Sprint | null;
  lastSprint: Sprint | null;
  people: Person[];
  currentSprintStartDate: string | null;
  currentSprintEndDate: string | null;
  lastSprintStartDate: string | null;
  lastSprintEndDate: string | null;
  metadata: {
    totalTasks: number;
    totalSprints: number;
    generatedAt: string;
    project: string;
  };
}

interface Finding {
  ruleId: string;
  severity: string;
  message: string;
  details: string;
}

interface SemanticAnalysis {
  sprintSummary?: string;
  taskQuality?: string;
  problematicTasks?: Array<{ id: number; title: string; issues: string[]; severity: string }>;
  duplicateOrOverlapping?: Array<{ ids: number[]; reason: string }>;
  unclearWork?: Array<{ id: number; title: string; problem: string }>;
  strengths?: string[];
  error?: string;
  raw?: string;
}

interface HygieneResult {
  findings: Finding[];
  grade: string;
  gradeLabel: string;
  semanticAnalysis?: SemanticAnalysis;
  summary: {
    currentSprint: string;
    currentSprintMetrics: Partial<SprintMetrics>;
    lastSprint: string;
    lastSprintMetrics: Partial<SprintMetrics>;
    totalTasksCurrent: number;
    activeTasksCurrent: number;
    newTasksCurrent: number;
    closedTasksCurrent: number;
    criticalIssues: number;
    warnings: number;
    teamMembers: number;
    personBreakdown: Record<string, number>;
    currentSprintStartDate: string | null;
    currentSprintEndDate: string | null;
    lastSprintStartDate: string | null;
    lastSprintEndDate: string | null;
  };
}

interface HygieneRule {
  id: string;
  warning_threshold: number;
  critical_threshold: number;
  warning_threshold_multiplier?: number;
  underutilized_threshold_multiplier?: number;
  unclear_patterns?: string[];
}

interface RulesConfig {
  rules: HygieneRule[];
  health_grades: {
    A: { label: string };
    B: { label: string };
    C: { label: string };
    D: { label: string };
    F: { label: string; min_criticals: number };
  };
}

interface SendEmailResult {
  status: string;
  path?: string;
  error?: string;
  result?: string;
}

// ============================================================
// CONFIGURATION
// ============================================================
const config = {
  azureDevOps: {
    orgUrl: process.env.AZURE_DEVOPS_ORG_URL ?? "https://dev.azure.com/HelpablesOrg",
    project: process.env.AZURE_DEVOPS_PROJECT ?? "aidapp",
    pat: process.env.AZURE_DEVOPS_PAT ?? "",
  },
  email: {
    to: process.env.EMAIL_TO ?? "anam@helpables.org,cliqueadmin@helpables.org",
    from: process.env.EMAIL_FROM ?? "rookie-agent@hermes",
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseUrl: "https://openrouter.ai/api/v1",
    model: process.env.AI_MODEL ?? "qwen/qwen3-coder",
  },
};

// ============================================================
// 1. FETCH SPRINT DATA FROM AZURE DEVOPS
// ============================================================
async function fetchSprintData(): Promise<SprintData> {
  const authHandler = getPersonalAccessTokenHandler(config.azureDevOps.pat);
  const webApi = new WebApi(config.azureDevOps.orgUrl, authHandler);
  const witApi = await webApi.getWorkItemTrackingApi();
  const project = config.azureDevOps.project;

  console.log("📡 Fetching sprint data from Azure DevOps...");

  // Step 1: use Work API team iterations to find current and last sprint by actual date ranges
  const coreApi = await webApi.getCoreApi();
  const workApi = await webApi.getWorkApi();
  const teams = await coreApi.getTeams(project);
  const team = teams[0]; // default/first team

  let currentSprintPath: string | null = null;
  let lastSprintPath: string | null = null;
  let currentSprintStartDate: string | null = null;
  let currentSprintEndDate: string | null = null;
  let lastSprintStartDate: string | null = null;
  let lastSprintEndDate: string | null = null;

  if (team?.id) {
    const teamContext = { project, team: team.id };
    const iterations = await workApi.getTeamIterations(teamContext) ?? [];
    const now = new Date();

    let currentIter: any = null;
    let lastIter: any = null;

    for (const iter of iterations) {
      const attrs = (iter as any).attributes;
      const start = attrs?.startDate ? new Date(attrs.startDate) : null;
      const finish = attrs?.finishDate ? new Date(attrs.finishDate) : null;

      // Current sprint: timeFrame marked "current" OR date range contains today
      if (attrs?.timeFrame === "current" || (start && finish && now >= start && now <= finish)) {
        currentIter = iter;
      }
      // Last sprint: most recently completed sprint before today
      if (finish && finish < now) {
        if (!lastIter || finish > new Date((lastIter as any).attributes.finishDate)) {
          lastIter = iter;
        }
      }
    }

    // Between sprints: if no active sprint, treat most recent past as current, one before as last
    if (!currentIter && lastIter) {
      currentIter = lastIter;
      lastIter = null;
      for (const iter of iterations) {
        const finish = (iter as any).attributes?.finishDate ? new Date((iter as any).attributes.finishDate) : null;
        const currentFinish = new Date((currentIter as any).attributes.finishDate);
        if (finish && finish < currentFinish) {
          if (!lastIter || finish > new Date((lastIter as any).attributes.finishDate)) {
            lastIter = iter;
          }
        }
      }
    }

    currentSprintPath = (currentIter as any)?.path ?? null;
    lastSprintPath = (lastIter as any)?.path ?? null;
    currentSprintStartDate = (currentIter as any)?.attributes?.startDate
      ? new Date((currentIter as any).attributes.startDate).toISOString().split("T")[0]
      : null;
    currentSprintEndDate = (currentIter as any)?.attributes?.finishDate
      ? new Date((currentIter as any).attributes.finishDate).toISOString().split("T")[0]
      : null;
    lastSprintStartDate = (lastIter as any)?.attributes?.startDate
      ? new Date((lastIter as any).attributes.startDate).toISOString().split("T")[0]
      : null;
    lastSprintEndDate = (lastIter as any)?.attributes?.finishDate
      ? new Date((lastIter as any).attributes.finishDate).toISOString().split("T")[0]
      : null;

    console.log(`   Detected current sprint: ${currentSprintPath ?? "none"}`);
    console.log(`   Detected last sprint:    ${lastSprintPath ?? "none"}`);
  }

  if (!currentSprintPath) {
    return { tasks: [], sprints: [], currentSprint: null, lastSprint: null, people: [], currentSprintStartDate: null, currentSprintEndDate: null, lastSprintStartDate: null, lastSprintEndDate: null, metadata: { totalTasks: 0, totalSprints: 0, generatedAt: new Date().toISOString(), project } };
  }

  // Step 2: fetch tasks scoped to only the current and last sprint
  const sprintPaths = [currentSprintPath, lastSprintPath].filter(Boolean) as string[];
  const pathConditions = sprintPaths
    .map(p => `[System.IterationPath] = '${p}'`)
    .join(" Or ");

  const wiql = {
    query: `Select [System.Id], [System.Title], [System.State], [System.AssignedTo], 
            [System.IterationPath], [System.ChangedDate], [System.ChangedBy], [System.CreatedDate]
            From WorkItems 
            Where [System.WorkItemType] = 'Task' 
              And [System.TeamProject] = '${project}'
              And (${pathConditions})`
  };

  const wiqlResult = await witApi.queryByWiql(wiql, { project });
  if (!wiqlResult.workItems || wiqlResult.workItems.length === 0) {
    return { tasks: [], sprints: [], currentSprint: null, lastSprint: null, people: [], currentSprintStartDate: null, currentSprintEndDate: null, lastSprintStartDate: null, lastSprintEndDate: null, metadata: { totalTasks: 0, totalSprints: 0, generatedAt: new Date().toISOString(), project } };
  }

  // Fetch batch details
  const ids = wiqlResult.workItems.map(item => item.id as number);
  const allWorkItems: any[] = [];
  const batchSize = 200;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = await witApi.getWorkItems(ids.slice(i, i + batchSize));
    if (batch) allWorkItems.push(...batch);
  }

  // Group by iteration path (sprint)
  const sprintMap = new Map<string, Sprint>();
  const personMap = new Map<string, Person>();
  const now = new Date();

  allWorkItems.forEach(wi => {
    const fields = wi.fields ?? {};
    const iterationPath: string = fields["System.IterationPath"] ?? "Unassigned";
    const state: string = fields["System.State"] ?? "Unknown";
    const title: string = fields["System.Title"] ?? "";
    const assignedTo: string = fields["System.AssignedTo"]?.displayName ?? "Unassigned";
    const changedDate: Date | null = fields["System.ChangedDate"] ? new Date(fields["System.ChangedDate"]) : null;
    const createdDate: Date | null = fields["System.CreatedDate"] ? new Date(fields["System.CreatedDate"]) : null;

    const task: Task = {
      id: wi.id ?? 0,
      title,
      state,
      assignedTo,
      iterationPath,
      changedDate,
      createdDate,
      daysSinceChange: changedDate ? Math.floor((now.getTime() - changedDate.getTime()) / (1000 * 60 * 60 * 24)) : null,
      daysSinceCreated: createdDate ? Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)) : null,
    };

    // Sprint grouping
    if (!sprintMap.has(iterationPath)) {
      sprintMap.set(iterationPath, { name: iterationPath, tasks: [], stateCounts: {} });
    }
    const sprint = sprintMap.get(iterationPath)!;
    sprint.tasks.push(task);
    sprint.stateCounts[state] = (sprint.stateCounts[state] ?? 0) + 1;

    // Person grouping
    if (!personMap.has(assignedTo)) {
      personMap.set(assignedTo, { name: assignedTo, taskCount: 0, activeTasks: 0, newTasks: 0 });
    }
    const person = personMap.get(assignedTo)!;
    person.taskCount++;
    if (state === "Active") person.activeTasks++;
    if (state === "New") person.newTasks++;
  });

  // Identify current and last sprint by the date-detected paths from the Work API
  const sprints = Array.from(sprintMap.values());
  const currentSprint = sprints.find(s => s.name === currentSprintPath) ?? sprints[0] ?? null;
  const lastSprint = sprints.find(s => s.name === lastSprintPath) ?? sprints[1] ?? null;

  return {
    tasks: allWorkItems.map(wi => ({
      id: wi.id ?? 0,
      title: wi.fields?.["System.Title"] ?? "",
      state: wi.fields?.["System.State"] ?? "Unknown",
      assignedTo: wi.fields?.["System.AssignedTo"]?.displayName ?? "Unassigned",
      iterationPath: wi.fields?.["System.IterationPath"] ?? "Unassigned",
      changedDate: wi.fields?.["System.ChangedDate"] ? new Date(wi.fields["System.ChangedDate"]).toISOString() : null,
      createdDate: wi.fields?.["System.CreatedDate"] ? new Date(wi.fields["System.CreatedDate"]).toISOString() : null,
      daysSinceChange: wi.fields?.["System.ChangedDate"]
        ? Math.floor((now.getTime() - new Date(wi.fields["System.ChangedDate"]).getTime()) / (1000 * 60 * 60 * 24))
        : null,
    })),
    sprints,
    currentSprint,
    lastSprint,
    people: Array.from(personMap.values()),
    currentSprintStartDate,
    currentSprintEndDate,
    lastSprintStartDate,
    lastSprintEndDate,
    metadata: {
      totalTasks: allWorkItems.length,
      totalSprints: sprints.length,
      generatedAt: now.toISOString(),
      project,
    }
  };
}

// ============================================================
// 2. RUN HYGIENE RULE CHECKS (Current + Last Sprint Only)
// ============================================================
function evaluateHygiene(data: SprintData): HygieneResult {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "rules", "sprint-hygiene-rules.json"), "utf-8")) as RulesConfig;
  const findings: Finding[] = [];

  if (!data.currentSprint) {
    findings.push({ ruleId: "NO_CURRENT_SPRINT", severity: "CRITICAL", message: "No current sprint identified", details: "Could not determine the active sprint." });
    return {
      findings,
      grade: "F",
      gradeLabel: "F — Failing",
      summary: {
        currentSprint: "N/A",
        currentSprintMetrics: {},
        lastSprint: "N/A",
        lastSprintMetrics: {},
        totalTasksCurrent: 0,
        activeTasksCurrent: 0,
        newTasksCurrent: 0,
        closedTasksCurrent: 0,
        criticalIssues: 1,
        warnings: 0,
        teamMembers: 0,
        personBreakdown: {},
        currentSprintStartDate: null,
        currentSprintEndDate: null,
        lastSprintStartDate: null,
        lastSprintEndDate: null,
      }
    };
  }

  const currentSprint = data.currentSprint;
  const lastSprint = data.lastSprint;
  const now = new Date();

  // Analyze current sprint (always)
  analyzeSprint(currentSprint, "Current Sprint", rules, findings, now);

  // Analyze last sprint for comparison
  if (lastSprint) {
    analyzeSprint(lastSprint, "Last Sprint", rules, findings, now);
    checkCarryOver(currentSprint, lastSprint, findings);
  }

  // Compute health grade
  const criticals = findings.filter(f => f.severity === "CRITICAL").length;
  const warnings = findings.filter(f => f.severity === "WARNING").length;
  const grades = rules.health_grades;

  let grade = "A";
  let gradeLabel = grades.A.label;
  if (criticals >= grades.F.min_criticals) { grade = "F"; gradeLabel = grades.F.label; }
  else if (criticals >= 2 || warnings >= 10) { grade = "D"; gradeLabel = grades.D.label; }
  else if (criticals >= 1 || warnings >= 5) { grade = "C"; gradeLabel = grades.C.label; }
  else if (warnings >= 3) { grade = "B"; gradeLabel = grades.B.label; }
  else if (warnings <= 1) { grade = "A"; gradeLabel = grades.A.label; }

  // Collect person breakdown
  const allPersonBreakdown: Record<string, number> = {};
  if (currentSprint.metrics?.personBreakdown) {
    Object.entries(currentSprint.metrics.personBreakdown).forEach(([person, count]) => {
      allPersonBreakdown[person] = (allPersonBreakdown[person] ?? 0) + count;
    });
  }

  const people = data.people ?? [];
  const teamMembers = new Set([...Object.keys(allPersonBreakdown), ...people.map(p => p.name)]);

  return {
    findings,
    grade,
    gradeLabel,
    summary: {
      currentSprint: currentSprint.name,
      currentSprintMetrics: currentSprint.metrics ?? {},
      lastSprint: lastSprint ? lastSprint.name : "N/A",
      lastSprintMetrics: lastSprint ? (lastSprint.metrics ?? {}) : {},
      totalTasksCurrent: currentSprint.metrics?.totalTasks ?? currentSprint.tasks.length,
      activeTasksCurrent: currentSprint.metrics?.activeTasks ?? 0,
      newTasksCurrent: currentSprint.metrics?.newTasks ?? 0,
      closedTasksCurrent: currentSprint.metrics?.closedTasks ?? 0,
      criticalIssues: criticals,
      warnings,
      teamMembers: teamMembers.size,
      personBreakdown: allPersonBreakdown,
      currentSprintStartDate: data.currentSprintStartDate,
      currentSprintEndDate: data.currentSprintEndDate,
      lastSprintStartDate: data.lastSprintStartDate,
      lastSprintEndDate: data.lastSprintEndDate,
    }
  };
}

function analyzeSprint(sprint: Sprint, sprintLabel: string, rules: RulesConfig, findings: Finding[], _now: Date): void {
  if (!sprint?.tasks?.length) return;

  const tasks = sprint.tasks;
  const totalTasks = tasks.length;
  const activeTasks = tasks.filter(t => t.state === "Active");
  const newTasks = tasks.filter(t => t.state === "New");
  const closedTasks = tasks.filter(t => t.state === "Closed");
  const removedTasks = tasks.filter(t => t.state === "Removed");

  // 1. WIP_LIMIT
  const wipRule = rules.rules.find(r => r.id === "WIP_LIMIT")!;
  const personActiveCounts: Record<string, number> = {};
  activeTasks.forEach(t => {
    personActiveCounts[t.assignedTo] = (personActiveCounts[t.assignedTo] ?? 0) + 1;
  });
  for (const [person, count] of Object.entries(personActiveCounts)) {
    if (count >= wipRule.critical_threshold) {
      findings.push({ ruleId: "WIP_LIMIT", severity: "CRITICAL", message: `${person} has ${count} active tasks (${sprintLabel})`, details: `Exceeds critical threshold of ${wipRule.critical_threshold} active tasks per person. This indicates context switching and potential burnout risk.` });
    } else if (count >= wipRule.warning_threshold) {
      findings.push({ ruleId: "WIP_LIMIT", severity: "WARNING", message: `${person} has ${count} active tasks (${sprintLabel})`, details: `Exceeds warning threshold of ${wipRule.warning_threshold} active tasks per person.` });
    }
  }

  // 2. TASK_STALENESS
  const stalenessRule = rules.rules.find(r => r.id === "TASK_STALENESS")!;
  const staleTasks = tasks.filter(t => t.daysSinceChange !== null && t.daysSinceChange > stalenessRule.warning_threshold);
  const criticalStale = staleTasks.filter(t => (t.daysSinceChange ?? 0) > stalenessRule.critical_threshold);

  if (criticalStale.length > 0) {
    findings.push({ ruleId: "TASK_STALENESS", severity: "CRITICAL", message: `${criticalStale.length} tasks untouched for >${stalenessRule.critical_threshold} days (${sprintLabel})`, details: criticalStale.slice(0, 10).map(t => `#${t.id}: ${t.title} (${t.daysSinceChange} days, ${t.state})`).join("\n") });
  } else if (staleTasks.length > 0) {
    findings.push({ ruleId: "TASK_STALENESS", severity: "WARNING", message: `${staleTasks.length} tasks untouched for >${stalenessRule.warning_threshold} days (${sprintLabel})`, details: staleTasks.slice(0, 10).map(t => `#${t.id}: ${t.title} (${t.daysSinceChange} days, ${t.state})`).join("\n") });
  }

  // 3. UNASSIGNED_TASKS
  const unassignedRule = rules.rules.find(r => r.id === "UNASSIGNED_TASKS")!;
  const unassignedTasks = tasks.filter(t => t.assignedTo === "Unassigned" && (t.state === "Active" || t.state === "New"));
  const unassignedPct = (unassignedTasks.length / totalTasks) * 100;

  if (unassignedPct > unassignedRule.critical_threshold) {
    findings.push({ ruleId: "UNASSIGNED_TASKS", severity: "CRITICAL", message: `${unassignedTasks.length} unassigned tasks (${sprintLabel})`, details: `${unassignedPct.toFixed(1)}% of tasks have no owner. This indicates poor sprint planning. Every task must have a clear owner.` });
  } else if (unassignedTasks.length > unassignedRule.warning_threshold) {
    findings.push({ ruleId: "UNASSIGNED_TASKS", severity: "WARNING", message: `${unassignedTasks.length} unassigned tasks (${sprintLabel})`, details: `Tasks without owners: ${unassignedTasks.slice(0, 5).map(t => `#${t.id}: ${t.title}`).join(", ")}` });
  }

  // 4. SPRINT_COMPLETION_RATE
  const completionRule = rules.rules.find(r => r.id === "SPRINT_COMPLETION_RATE")!;
  const completionPct = (closedTasks.length / totalTasks) * 100;

  if (completionPct < completionRule.critical_threshold) {
    findings.push({ ruleId: "SPRINT_COMPLETION_RATE", severity: "CRITICAL", message: `Only ${completionPct.toFixed(1)}% of tasks completed (${sprintLabel})`, details: `${closedTasks.length}/${totalTasks} tasks closed. Sprint execution is severely behind schedule.` });
  } else if (completionPct < completionRule.warning_threshold) {
    findings.push({ ruleId: "SPRINT_COMPLETION_RATE", severity: "WARNING", message: `Only ${completionPct.toFixed(1)}% of tasks completed (${sprintLabel})`, details: `${closedTasks.length}/${totalTasks} tasks closed. Sprint is at risk of not meeting goals.` });
  }

  // 5. NEW_TASK_RATIO
  const newTaskRule = rules.rules.find(r => r.id === "NEW_TASK_RATIO")!;
  const newTaskPct = (newTasks.length / totalTasks) * 100;

  if (newTaskPct > newTaskRule.critical_threshold) {
    findings.push({ ruleId: "NEW_TASK_RATIO", severity: "CRITICAL", message: `${newTaskPct.toFixed(1)}% of tasks still in New state (${sprintLabel})`, details: `${newTasks.length}/${totalTasks} tasks haven't been started. This indicates poor sprint execution and lack of momentum.` });
  } else if (newTaskPct > newTaskRule.warning_threshold) {
    findings.push({ ruleId: "NEW_TASK_RATIO", severity: "WARNING", message: `${newTaskPct.toFixed(1)}% of tasks still in New state (${sprintLabel})`, details: `${newTasks.length}/${totalTasks} tasks haven't been started. Sprint needs to accelerate task pickup.` });
  }

  // 6. TASK_AGING_NEW
  const agingNewRule = rules.rules.find(r => r.id === "TASK_AGING_NEW")!;
  if (newTasks.length > 0) {
    const avgDaysInNew = newTasks.reduce((sum, t) => sum + (t.daysSinceCreated ?? 0), 0) / newTasks.length;
    if (avgDaysInNew > agingNewRule.critical_threshold) {
      findings.push({ ruleId: "TASK_AGING_NEW", severity: "CRITICAL", message: `Tasks sitting in New state average ${avgDaysInNew.toFixed(1)} days (${sprintLabel})`, details: `Tasks are not being picked up. Current average: ${avgDaysInNew.toFixed(1)} days (threshold: ${agingNewRule.critical_threshold} days).` });
    } else if (avgDaysInNew > agingNewRule.warning_threshold) {
      findings.push({ ruleId: "TASK_AGING_NEW", severity: "WARNING", message: `Tasks sitting in New state average ${avgDaysInNew.toFixed(1)} days (${sprintLabel})`, details: `Tasks should be picked up faster. Current average: ${avgDaysInNew.toFixed(1)} days (threshold: ${agingNewRule.warning_threshold} days).` });
    }
  }

  // 7. TASK_AGING_ACTIVE
  const agingActiveRule = rules.rules.find(r => r.id === "TASK_AGING_ACTIVE")!;
  if (activeTasks.length > 0) {
    const avgDaysInActive = activeTasks.reduce((sum, t) => sum + (t.daysSinceChange ?? 0), 0) / activeTasks.length;
    if (avgDaysInActive > agingActiveRule.critical_threshold) {
      findings.push({ ruleId: "TASK_AGING_ACTIVE", severity: "CRITICAL", message: `Active tasks average ${avgDaysInActive.toFixed(1)} days without progress (${sprintLabel})`, details: `Tasks are stalled. Current average: ${avgDaysInActive.toFixed(1)} days (threshold: ${agingActiveRule.critical_threshold} days). This indicates blocked work or lack of execution.` });
    } else if (avgDaysInActive > agingActiveRule.warning_threshold) {
      findings.push({ ruleId: "TASK_AGING_ACTIVE", severity: "WARNING", message: `Active tasks average ${avgDaysInActive.toFixed(1)} days without progress (${sprintLabel})`, details: `Tasks should complete faster. Current average: ${avgDaysInActive.toFixed(1)} days (threshold: ${agingActiveRule.warning_threshold} days).` });
    }
  }

  // 8. UNCLEAR_TITLES
  const unclearRule = rules.rules.find(r => r.id === "UNCLEAR_TITLES")!;
  const unclearPatterns = (unclearRule.unclear_patterns ?? []).map(p => p.toLowerCase());
  const unclearTasks = tasks.filter(t =>
    unclearPatterns.some(p => t.title.toLowerCase().includes(p))
  );
  const unclearPct = (unclearTasks.length / totalTasks) * 100;

  if (unclearPct > unclearRule.critical_threshold) {
    findings.push({ ruleId: "UNCLEAR_TITLES", severity: "CRITICAL", message: `${unclearPct.toFixed(1)}% of tasks have unclear titles (${sprintLabel})`, details: `${unclearTasks.length}/${totalTasks} tasks. Poor planning: ${unclearTasks.slice(0, 5).map(t => `#${t.id}: "${t.title}"`).join(", ")}` });
  } else if (unclearPct > unclearRule.warning_threshold) {
    findings.push({ ruleId: "UNCLEAR_TITLES", severity: "WARNING", message: `${unclearPct.toFixed(1)}% of tasks have unclear titles (${sprintLabel})`, details: `${unclearTasks.length}/${totalTasks} tasks: ${unclearTasks.slice(0, 5).map(t => `#${t.id}: "${t.title}"`).join(", ")}` });
  }

  // 9. WORKLOAD_BALANCE
  const workloadRule = rules.rules.find(r => r.id === "WORKLOAD_BALANCE")!;
  const personTaskCounts: Record<string, number> = {};
  tasks.forEach(t => {
    personTaskCounts[t.assignedTo] = (personTaskCounts[t.assignedTo] ?? 0) + 1;
  });
  const totalPeople = Object.keys(personTaskCounts).length;
  if (totalPeople > 1) {
    const avgTasksPerPerson = totalTasks / totalPeople;
    const overloaded = Object.entries(personTaskCounts)
      .filter(([, count]) => count > avgTasksPerPerson * (workloadRule.warning_threshold_multiplier ?? 2));
    const underutilized = Object.entries(personTaskCounts)
      .filter(([, count]) => count < avgTasksPerPerson * (workloadRule.underutilized_threshold_multiplier ?? 0.4));

    if (overloaded.length > 0) {
      findings.push({ ruleId: "WORKLOAD_BALANCE", severity: "WARNING", message: `${overloaded.length} team members are overloaded (${sprintLabel})`, details: `Overloaded (>2x average): ${overloaded.map(([person, count]) => `${person}: ${count} tasks`).join(", ")}. Average: ${avgTasksPerPerson.toFixed(1)} tasks/person.` });
    }
    if (underutilized.length > 0) {
      findings.push({ ruleId: "WORKLOAD_BALANCE", severity: "WARNING", message: `${underutilized.length} team members are underutilized (${sprintLabel})`, details: `Underutilized (<40% average): ${underutilized.map(([person, count]) => `${person}: ${count} tasks`).join(", ")}. Average: ${avgTasksPerPerson.toFixed(1)} tasks/person.` });
    }
  }

  // 10. ZERO_ACTIVITY_PERSONS
  const inactiveMembers = Object.entries(personTaskCounts).filter(([, count]) => count === 0);
  if (inactiveMembers.length > 0) {
    findings.push({ ruleId: "ZERO_ACTIVITY_PERSONS", severity: "WARNING", message: `${inactiveMembers.length} team members have zero tasks in ${sprintLabel}`, details: `Inactive: ${inactiveMembers.map(([person]) => person).join(", ")}. This indicates poor resource utilization.` });
  }

  // 11. SPRINT_SCOPE_CREEP
  const scopeCreepRule = rules.rules.find(r => r.id === "SPRINT_SCOPE_CREEP")!;
  const createdDates = tasks.filter(t => t.createdDate).map(t => new Date(t.createdDate as Date)).sort((a, b) => a.getTime() - b.getTime());
  if (createdDates.length >= 2) {
    const sprintStart = createdDates[0];
    const scopeBoundary = new Date(sprintStart.getTime() + 2 * 24 * 60 * 60 * 1000);
    const midSprintTasks = tasks.filter(t => t.createdDate && new Date(t.createdDate) > scopeBoundary);
    const midSprintPct = (midSprintTasks.length / totalTasks) * 100;

    if (midSprintPct > scopeCreepRule.critical_threshold) {
      findings.push({ ruleId: "SPRINT_SCOPE_CREEP", severity: "CRITICAL", message: `${midSprintPct.toFixed(1)}% of tasks added mid-sprint (${sprintLabel})`, details: `${midSprintTasks.length}/${totalTasks} tasks created after sprint started (${sprintStart.toISOString().split("T")[0]}). This indicates poor sprint planning and scope creep.` });
    } else if (midSprintPct > scopeCreepRule.warning_threshold) {
      findings.push({ ruleId: "SPRINT_SCOPE_CREEP", severity: "WARNING", message: `${midSprintPct.toFixed(1)}% of tasks added mid-sprint (${sprintLabel})`, details: `${midSprintTasks.length}/${totalTasks} tasks created after sprint started (${sprintStart.toISOString().split("T")[0]}).` });
    }
  }

  // 12. SINGLE_PERSON_DEPENDENCY
  const singlePersonRule = rules.rules.find(r => r.id === "SINGLE_PERSON_DEPENDENCY")!;
  const maxPersonLoad = Math.max(...Object.values(personTaskCounts));
  const maxPersonShare = (maxPersonLoad / totalTasks) * 100;
  const maxPersonEntry = Object.entries(personTaskCounts).find(([, count]) => count === maxPersonLoad);
  const maxPerson = maxPersonEntry?.[0];

  if (maxPersonShare > singlePersonRule.critical_threshold) {
    findings.push({ ruleId: "SINGLE_PERSON_DEPENDENCY", severity: "CRITICAL", message: `${maxPerson} carries ${maxPersonShare.toFixed(1)}% of sprint tasks (${sprintLabel})`, details: `${maxPersonLoad}/${totalTasks} tasks. This is a bus factor risk. Sprint is overly dependent on one person.` });
  } else if (maxPersonShare > singlePersonRule.warning_threshold) {
    findings.push({ ruleId: "SINGLE_PERSON_DEPENDENCY", severity: "WARNING", message: `${maxPerson} carries ${maxPersonShare.toFixed(1)}% of sprint tasks (${sprintLabel})`, details: `${maxPersonLoad}/${totalTasks} tasks. Consider redistributing work.` });
  }

  // Store sprint metrics
  sprint.metrics = {
    totalTasks,
    activeTasks: activeTasks.length,
    newTasks: newTasks.length,
    closedTasks: closedTasks.length,
    removedTasks: removedTasks.length,
    completionPct,
    newTaskPct,
    avgDaysInNew: newTasks.length > 0 ? (newTasks.reduce((sum, t) => sum + (t.daysSinceCreated ?? 0), 0) / newTasks.length) : 0,
    avgDaysInActive: activeTasks.length > 0 ? (activeTasks.reduce((sum, t) => sum + (t.daysSinceChange ?? 0), 0) / activeTasks.length) : 0,
    personBreakdown: personTaskCounts,
  };
}

function checkCarryOver(currentSprint: Sprint, lastSprint: Sprint, findings: Finding[]): void {
  const carryOverRule = { warning_threshold: 15, critical_threshold: 30 };

  const lastSprintTaskIds = new Set(lastSprint.tasks.filter(t => t.state !== "Closed").map(t => t.id));
  const carryOverTasks = currentSprint.tasks.filter(t => lastSprintTaskIds.has(t.id));
  const carryOverPct = currentSprint.tasks.length > 0 ? (carryOverTasks.length / currentSprint.tasks.length) * 100 : 0;

  if (carryOverPct > carryOverRule.critical_threshold) {
    findings.push({ ruleId: "CARRY_OVER", severity: "CRITICAL", message: `${carryOverPct.toFixed(1)}% of current sprint is carry-over from last sprint`, details: `${carryOverTasks.length}/${currentSprint.tasks.length} tasks carried over. Last sprint failed to complete its work. This indicates poor sprint execution and planning.` });
  } else if (carryOverPct > carryOverRule.warning_threshold) {
    findings.push({ ruleId: "CARRY_OVER", severity: "WARNING", message: `${carryOverPct.toFixed(1)}% of current sprint is carry-over from last sprint`, details: `${carryOverTasks.length}/${currentSprint.tasks.length} tasks carried over from last sprint.` });
  }
}

// ============================================================
// 2.5 SEMANTIC WORK QUALITY ANALYSIS
// ============================================================
async function analyzeWorkQuality(data: SprintData): Promise<SemanticAnalysis> {
  console.log("🧠 Running semantic work quality analysis (Gemini 2.5 Pro)...");

  const client = new OpenAI({
    apiKey: config.openrouter.apiKey,
    baseURL: config.openrouter.baseUrl,
  });

  const currentSprint = data.currentSprint;
  const lastSprint = data.lastSprint;

  const currentTasks = currentSprint?.tasks.map(t => ({
    id: t.id,
    title: t.title,
    state: t.state,
    assignedTo: t.assignedTo,
  })) ?? [];

  const lastTasks = lastSprint ? lastSprint.tasks.map(t => ({
    id: t.id,
    title: t.title,
    state: t.state,
    assignedTo: t.assignedTo,
  })) : [];

  const prompt = `You are a senior software engineering manager evaluating sprint task quality. Your job is to assess whether the tasks make sense as real engineering work.

CURRENT SPRINT: ${currentSprint?.name ?? "Unknown"}
Tasks (${currentTasks.length} total):
${currentTasks.map(t => `#${t.id} [${t.state}] (${t.assignedTo}): ${t.title}`).join("\n")}

${lastSprint ? `LAST SPRINT: ${lastSprint.name}
Tasks (${lastTasks.length} total):
${lastTasks.map(t => `#${t.id} [${t.state}] (${t.assignedTo}): ${t.title}`).join("\n")}` : ""}

Evaluate each task and provide a JSON response with this exact structure:
{
  "sprintSummary": "2-3 sentence summary of what this sprint is actually trying to accomplish",
  "taskQuality": "overall assessment: good/fair/poor",
  "problematicTasks": [{"id": 123, "title": "task title", "issues": ["list of specific problems"], "severity": "warning or critical"}],
  "duplicateOrOverlapping": [{"ids": [123, 456], "reason": "why these appear to overlap"}],
  "unclearWork": [{"id": 123, "title": "task title", "problem": "why the actual work is unclear"}],
  "strengths": ["list of well-defined, clear tasks or patterns"]
}

Only return JSON. No markdown, no code fences.`;

  const response = await client.chat.completions.create({
    model: "google/gemini-2.5-pro",
    messages: [
      { role: "system", content: "You are a meticulous engineering manager. Evaluate task quality rigorously. Return only valid JSON." },
      { role: "user", content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 8000,
    response_format: { type: "json_object" }
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content) as SemanticAnalysis;
  } catch (e) {
    console.error("Failed to parse Gemini response:", (e as Error).message);
    return { error: "Failed to parse semantic analysis", raw: content };
  }
}

// ============================================================
// 3. GENERATE AI EMAIL REPORT
// ============================================================
async function generateEmail(data: SprintData, hygieneResult: HygieneResult): Promise<string> {
  console.log("🤖 Generating AI-powered email report...");

  const client = new OpenAI({
    apiKey: config.openrouter.apiKey,
    baseURL: config.openrouter.baseUrl,
  });

  const rulesDoc = fs.readFileSync(path.join(__dirname, "..", "rules", "sprint-hygiene-rules.md"), "utf-8");

  // Load system prompt from external file (edit sprint-health-analyst.md to customise AI behaviour)
  const systemPromptPath = path.join(__dirname, "..", "sprint-health-analyst.md");
  const systemPrompt = fs.existsSync(systemPromptPath)
    ? fs.readFileSync(systemPromptPath, "utf-8")
    : "You are an expert sprint health analyst and professional email writer. Write clear, actionable reports. Output raw HTML only, no code fences.";

  console.log(`📋 System prompt: ${fs.existsSync(systemPromptPath) ? `loaded from sprint-health-analyst.md (${systemPrompt.length} chars)` : "⚠️  FILE NOT FOUND — using hardcoded fallback"}`);
  console.log(`🤖 Model: ${config.openrouter.model}`);

  // Calculate sprint phase based on actual start date
  const today = new Date();
  const sprintStart = data.currentSprintStartDate ? new Date(data.currentSprintStartDate) : null;
  const sprintEnd = data.currentSprintEndDate ? new Date(data.currentSprintEndDate) : null;
  let sprintPhase = "Unknown";
  if (sprintStart && sprintEnd) {
    const totalDays = Math.ceil((sprintEnd.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24));
    const elapsedDays = Math.floor((today.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24));
    if (elapsedDays <= 2) sprintPhase = "Planning Window (day " + (elapsedDays + 1) + " of sprint)";
    else if (elapsedDays >= totalDays - 2) sprintPhase = "Closing Phase (day " + (elapsedDays + 1) + " of " + totalDays + ")";
    else sprintPhase = "Execution Phase (day " + (elapsedDays + 1) + " of " + totalDays + ")";
  }

  const dataPrompt = `## Sprint Dates
- Sprint Start: ${data.currentSprintStartDate ?? "unknown"}
- Sprint End: ${data.currentSprintEndDate ?? "unknown"}
- Today: ${today.toISOString().split("T")[0]}
- Sprint Phase: ${sprintPhase}

## Semantic Analysis (Work Quality)
Sprint Summary: ${hygieneResult.semanticAnalysis?.sprintSummary ?? "Not available"}
Overall Task Quality: ${hygieneResult.semanticAnalysis?.taskQuality ?? "Not assessed"}
Strengths: ${(hygieneResult.semanticAnalysis?.strengths ?? []).join("; ") || "None identified"}

## Current Sprint: ${hygieneResult.summary.currentSprint}
- Total Tasks: ${hygieneResult.summary.totalTasksCurrent}
- Active: ${hygieneResult.summary.activeTasksCurrent}
- New: ${hygieneResult.summary.newTasksCurrent}
- Closed: ${hygieneResult.summary.closedTasksCurrent}
- Completion Rate: ${hygieneResult.summary.currentSprintMetrics.completionPct?.toFixed(1) ?? "N/A"}%
- New Task Ratio: ${hygieneResult.summary.currentSprintMetrics.newTaskPct?.toFixed(1) ?? "N/A"}%
- Avg Days in New: ${hygieneResult.summary.currentSprintMetrics.avgDaysInNew?.toFixed(1) ?? "0"}
- Avg Days in Active: ${hygieneResult.summary.currentSprintMetrics.avgDaysInActive?.toFixed(1) ?? "0"}

## Last Sprint: ${hygieneResult.summary.lastSprint}
${hygieneResult.summary.lastSprintMetrics.totalTasks ? `- Total Tasks: ${hygieneResult.summary.lastSprintMetrics.totalTasks}
- Completion Rate: ${hygieneResult.summary.lastSprintMetrics.completionPct?.toFixed(1) ?? "N/A"}%` : "- No data available"}

## Health Grade: ${hygieneResult.grade} (${hygieneResult.gradeLabel})
- Critical Issues: ${hygieneResult.summary.criticalIssues}
- Warnings: ${hygieneResult.summary.warnings}

## Findings
${hygieneResult.findings.length > 0 ? hygieneResult.findings.map(f => `[${f.severity}] ${f.ruleId}: ${f.message}\n  ${f.details}`).join("\n\n") : "No findings — sprint passed all checks."}

## Team Breakdown (Current Sprint)
${Object.entries(hygieneResult.summary.personBreakdown ?? {}).map(([person, count]) => `- ${person}: ${count} tasks`).join("\n")}

## Sprint Hygiene Rules Applied
${rulesDoc.substring(0, 2500)}

Generate a COMPLETE HTML email (just the body, no <html>/<head> tags). Be firm and direct. This is an accountability report.
DO NOT wrap in code blocks or markdown. Output ONLY the HTML content directly.`;

  const response = await client.chat.completions.create({
    model: config.openrouter.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: dataPrompt }
    ],
    temperature: 0.3,
    max_tokens: 6000,
  });

  return response.choices[0]?.message?.content ?? "<p>AI generation failed</p>";
}

// ============================================================
// 4. SEND EMAIL VIA GMAIL (nodemailer)
// ============================================================
async function sendEmail(htmlBody: string, subject?: string): Promise<SendEmailResult> {
  const recipients = config.email.to.split(",").map(e => e.trim());
  const finalSubject = subject ?? `🏃 Sprint Health Report — ${config.azureDevOps.project}`;

  console.log(`📧 Sending via Gmail to: ${recipients.join(", ")}`);
  console.log(`📋 Subject: ${finalSubject}`);

  const hasOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;

  try {
    let transporter: nodemailer.Transporter;

    if (hasOAuth2) {
      transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          type: "OAuth2",
          user: process.env.GMAIL_USER ?? config.email.from,
          clientId: process.env.GMAIL_CLIENT_ID,
          clientSecret: process.env.GMAIL_CLIENT_SECRET,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN,
        },
      });
    } else if (process.env.GMAIL_APP_PASSWORD) {
      transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.GMAIL_USER ?? config.email.from,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });
    } else {
      throw new Error("No Gmail credentials configured. Set GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN or GMAIL_APP_PASSWORD.");
    }

    const info = await transporter.sendMail({
      from: config.email.from,
      to: recipients.join(","),
      subject: finalSubject,
      html: htmlBody,
    });

    console.log(`✅ Gmail send response: ${info.messageId}`);
    return { status: "sent", result: info.messageId };
  } catch (err) {
    const error = err as Error;
    console.error(`❌ Email send failed: ${error.message}`);

    // Fallback: save to file
    const outputPath = path.join(__dirname, "..", "output", `sprint-report-${new Date().toISOString().split("T")[0]}.html`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `<!DOCTYPE html><html><body>${htmlBody}</body></html>`);
    console.log(`📄 Fallback: saved to ${outputPath}`);
    return { status: "send_failed_saved_to_file", path: outputPath, error: error.message };
  }
}

// ============================================================
// MAIN ORCHESTRATION
// ============================================================
async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════");
  console.log("  🏃 Azure DevOps Sprint Health Monitor   ");
  console.log("  AI-Powered Analysis & Email Report      ");
  console.log("═══════════════════════════════════════════\n");

  try {
    // Step 1: Fetch data
    const data = await fetchSprintData();
    console.log(`✅ Fetched ${data.tasks.length} tasks across ${data.sprints.length} sprints`);
    console.log(`   Current sprint: ${data.currentSprint?.name ?? "Unknown"}`);
    console.log(`   Last sprint: ${data.lastSprint?.name ?? "Unknown"}\n`);

    // Step 2: Semantic quality analysis
    const semanticAnalysis = await analyzeWorkQuality(data);
    if (semanticAnalysis.error) {
      console.log(`⚠️  Semantic analysis error: ${semanticAnalysis.error}`);
    } else {
      console.log(`✅ Semantic quality complete`);
      console.log(`   Sprint summary: "${(semanticAnalysis.sprintSummary ?? "").substring(0, 120)}..."`);
      console.log(`   Task quality: ${semanticAnalysis.taskQuality ?? "unknown"}`);
      console.log(`   Problematic tasks: ${(semanticAnalysis.problematicTasks ?? []).length}`);
      console.log(`   Unclear work: ${(semanticAnalysis.unclearWork ?? []).length}`);
      console.log(`   Duplicates/overlaps: ${(semanticAnalysis.duplicateOrOverlapping ?? []).length}\n`);
    }

    // Step 3: Evaluate hygiene rules
    const hygieneResult = evaluateHygiene(data);

    // Step 4: Merge semantic findings
    hygieneResult.semanticAnalysis = semanticAnalysis;

    if (semanticAnalysis && !semanticAnalysis.error) {
      (semanticAnalysis.problematicTasks ?? []).forEach(pt => {
        hygieneResult.findings.push({
          ruleId: "SEMANTIC_QUALITY",
          severity: (pt.severity ?? "critical").toUpperCase(),
          message: `Task #${pt.id} "${pt.title}" — ${pt.issues[0] ?? "poorly defined"}`,
          details: pt.issues.join(". "),
        });
      });

      (semanticAnalysis.unclearWork ?? []).forEach(uw => {
        hygieneResult.findings.push({
          ruleId: "SEMANTIC_UNCLEAR_WORK",
          severity: "WARNING",
          message: `Task #${uw.id} "${uw.title}" — work is unclear`,
          details: uw.problem,
        });
      });

      (semanticAnalysis.duplicateOrOverlapping ?? []).forEach(dup => {
        hygieneResult.findings.push({
          ruleId: "SEMANTIC_DUPLICATE",
          severity: "CRITICAL",
          message: `Potential overlap detected: tasks ${dup.ids.join(", ")}`,
          details: dup.reason,
        });
      });

      // Recalculate grade
      const criticals = hygieneResult.findings.filter(f => f.severity === "CRITICAL").length;
      const warnings = hygieneResult.findings.filter(f => f.severity === "WARNING").length;
      if (criticals >= 3) { hygieneResult.grade = "F"; hygieneResult.gradeLabel = "F — Failing"; }
      else if (criticals >= 2 || warnings >= 10) { hygieneResult.grade = "D"; hygieneResult.gradeLabel = "D — Poor"; }
      else if (criticals >= 1 || warnings >= 5) { hygieneResult.grade = "C"; hygieneResult.gradeLabel = "C — Needs Improvement"; }
      else if (warnings >= 3) { hygieneResult.grade = "B"; hygieneResult.gradeLabel = "B — Good"; }
      else { hygieneResult.grade = "A"; hygieneResult.gradeLabel = "A — Excellent"; }

      hygieneResult.summary.criticalIssues = criticals;
      hygieneResult.summary.warnings = warnings;
    }

    console.log(`✅ Health Grade (after semantic merge): ${hygieneResult.grade}`);
    console.log(`   Critical issues: ${hygieneResult.summary.criticalIssues}`);
    console.log(`   Warnings: ${hygieneResult.summary.warnings}\n`);

    // Step 5: Generate AI email
    const emailHtml = await generateEmail(data, hygieneResult);
    console.log(`✅ AI email generated (${emailHtml.length} chars)\n`);

    // Step 6: Send email
    const subject = `🏃 Sprint Health Report [Grade: ${hygieneResult.grade}] — ${config.azureDevOps.project} — ${data.currentSprint?.name ?? "N/A"}`;
    const result = await sendEmail(emailHtml, subject);

    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  Result: ${result.status}`);
    if (result.path) console.log(`  File: ${result.path}`);
    if (result.error) console.log(`  Error: ${result.error}`);
    console.log(`═══════════════════════════════════════════`);

    // Output summary JSON
    const summaryPath = path.join(__dirname, "..", "output", `sprint-summary-${new Date().toISOString().split("T")[0]}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      grade: hygieneResult.grade,
      gradeLabel: hygieneResult.gradeLabel,
      semanticAnalysis,
      summary: hygieneResult.summary,
      findings: hygieneResult.findings,
      deliveryStatus: result.status,
    }, null, 2));

  } catch (err) {
    const error = err as Error;
    console.error(`\n❌ FATAL ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// ============================================================
// DAILY PROGRESS REPORT
// ============================================================

// Maps WIT state names → taskboard lane display names
const STATE_TO_LANE: Record<string, string> = {
  New: "To do",
  Active: "In Progress",
  Resolved: "In Review",
  Closed: "Completed",
  Done: "Completed",
  Completed: "Completed",
  Removed: "Removed",
};

interface DailyTask {
  id: number;
  title: string;
  state: string;        // raw WIT state (New / Active / Closed)
  lane: string;         // taskboard lane (To do / In Progress / In Review / Completed / Blocked)
  workItemType: string;
  assignedTo: string;
  parentId: number | null;
  parentTitle: string | null;
  changedToday: boolean;
  comments: string[];
  hasArtifact: boolean;
  artifactMissing: boolean;
  expectedArtifact?: string;
}

interface StoryGroup {
  storyId: number | null;
  storyTitle: string;
  storyDescription: string;
  tasks: DailyTask[];
}

interface DailyProgressData {
  date: string;
  sprint: string;
  sprintStartDate: string | null;
  sprintEndDate: string | null;
  // Full taskboard
  allTasks: DailyTask[];
  byState: Record<string, DailyTask[]>;
  byStory: StoryGroup[];
  // Today's activity
  closedToday: DailyTask[];
  activatedToday: DailyTask[];
  // Artifact issues
  allClosed: DailyTask[];
  noArtifact: DailyTask[];
  // Counts
  stateSummary: Record<string, number>;
}

function hasArtifactInComments(comments: string[]): boolean {
  const artifactPatterns = [
    /https?:\/\//i,
    /PR\s*#?\d+/i,
    /pull request/i,
    /deployed/i,
    /published/i,
    /merged/i,
    /released/i,
    /attached/i,
    /deliverable/i,
    /loom\.com/i,
    /figma\.com/i,
    /notion\.so/i,
    /docs\.google/i,
    /drive\.google/i,
    /sharepoint/i,
    /confluence/i,
    /github\.com/i,
    /bitbucket/i,
    /artifact/i,
    /screenshot/i,
    /recording/i,
  ];
  return comments.some(c => artifactPatterns.some(p => p.test(c)));
}

async function fetchDailyProgressData(): Promise<DailyProgressData> {
  const { orgUrl, project, pat } = config.azureDevOps;
  const authHandler = getPersonalAccessTokenHandler(pat);
  const connection = new WebApi(orgUrl, authHandler);
  const witApi = await connection.getWorkItemTrackingApi();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  // Step 1: detect current sprint via Work API (same logic as fetchSprintData)
  const workApi = await (connection as any).getWorkApi();
  const teams = await (connection as any).getCoreApi().then((c: any) => c.getTeams(project));
  const team = teams?.[0];
  let currentSprintPath: string | null = null;
  let sprintStartDate: string | null = null;
  let sprintEndDate: string | null = null;

  if (team) {
    const iterations = await workApi.getTeamIterations({ project, team: team.name });
    if (iterations?.length) {
      const now = new Date();
      const currentIter = iterations.find((iter: any) => {
        const attrs = (iter as any).attributes;
        const start = attrs?.startDate ? new Date(attrs.startDate) : null;
        const finish = attrs?.finishDate ? new Date(attrs.finishDate) : null;
        if (start && finish) return now >= start && now <= finish;
        return (iter as any).attributes?.timeFrame === "current";
      }) ?? iterations.find((iter: any) => (iter as any).attributes?.timeFrame === "current");
      if (currentIter) {
        currentSprintPath = (currentIter as any).path ?? null;
        sprintStartDate = (currentIter as any).attributes?.startDate
          ? new Date((currentIter as any).attributes.startDate).toISOString().split("T")[0]
          : null;
        sprintEndDate = (currentIter as any).attributes?.finishDate
          ? new Date((currentIter as any).attributes.finishDate).toISOString().split("T")[0]
          : null;
      }
    }
  }

  if (!currentSprintPath) {
    return { date: todayStr, sprint: "unknown", sprintStartDate: null, sprintEndDate: null, allTasks: [], byState: {}, byStory: [], closedToday: [], activatedToday: [], allClosed: [], noArtifact: [], stateSummary: {} };
  }

  // Step 2: fetch Active + Closed tasks in current sprint only
  const wiql = {
    query: `SELECT [System.Id] FROM WorkItems
            WHERE [System.TeamProject] = '${project}'
              AND [System.IterationPath] = '${currentSprintPath}'
              AND [System.State] IN ('Active', 'Closed', 'Done', 'Resolved', 'Completed')
            ORDER BY [System.ChangedDate] DESC`,
  };

  const result = await witApi.queryByWiql(wiql, { project });
  if (!result.workItems || result.workItems.length === 0) {
    return { date: todayStr, sprint: currentSprintPath, sprintStartDate, sprintEndDate, allTasks: [], byState: {}, byStory: [], closedToday: [], activatedToday: [], allClosed: [], noArtifact: [], stateSummary: {} };
  }

  const ids = result.workItems.map(w => w.id as number).filter(Boolean);
  const rawItems: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    // Fetch System.BoardColumn so we get the exact taskboard lane (In Progress vs In Review, Completed vs Blocked)
    const batch = await witApi.getWorkItems(ids.slice(i, i + 200), [
      "System.Id", "System.Title", "System.State", "System.WorkItemType",
      "System.AssignedTo", "System.ChangedDate", "System.Parent",
      "System.BoardColumn",
    ]);
    if (batch) rawItems.push(...batch);
  }

  // Step 3: fetch parent title + description
  const parentIds = [...new Set(rawItems.map(wi => wi.fields?.["System.Parent"] as number).filter(Boolean))];
  const parentMap = new Map<number, { title: string; description: string }>();
  if (parentIds.length > 0) {
    for (let i = 0; i < parentIds.length; i += 200) {
      const batch = await witApi.getWorkItems(parentIds.slice(i, i + 200), ["System.Id", "System.Title", "System.Description"]);
      if (batch) batch.forEach(p => {
        if (p?.id) parentMap.set(p.id, {
          title: p.fields?.["System.Title"] ?? "",
          description: (p.fields?.["System.Description"] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 300),
        });
      });
    }
  }

  // Step 4: build flat task list (all sprint items)
  const CLOSED_STATES = new Set(["Closed", "Done", "Resolved", "Completed"]);
  const allItemsRaw: DailyTask[] = [];

  for (const wi of rawItems) {
    const f = wi.fields ?? {};
    const state: string = f["System.State"] ?? "Unknown";
    const changedDate = f["System.ChangedDate"] ? new Date(f["System.ChangedDate"]) : null;
    const changedDay = changedDate ? new Date(changedDate) : null;
    if (changedDay) changedDay.setHours(0, 0, 0, 0);
    const changedToday = changedDay?.getTime() === today.getTime();
    const parentId: number | null = f["System.Parent"] ?? null;
    const parent = parentId ? parentMap.get(parentId) : null;
    const isClosed = CLOSED_STATES.has(state);

    let comments: string[] = [];
    if (isClosed) {
      try {
        const commentResult = await (witApi as any).getComments(project, wi.id);
        comments = (commentResult?.comments ?? []).map((c: any) => c.text ?? "");
      } catch { /* comments unavailable */ }
    }

    const artifactPresent = hasArtifactInComments(comments);
    // Use System.BoardColumn for the exact lane name; fall back to STATE_TO_LANE mapping
    const boardColumn: string = f["System.BoardColumn"] ?? STATE_TO_LANE[state] ?? state;
    allItemsRaw.push({
      id: wi.id ?? 0,
      title: f["System.Title"] ?? "",
      state,
      lane: boardColumn,
      workItemType: f["System.WorkItemType"] ?? "Task",
      assignedTo: f["System.AssignedTo"]?.displayName ?? "Unassigned",
      parentId,
      parentTitle: parent?.title ?? null,
      changedToday: changedToday ?? false,
      comments,
      hasArtifact: artifactPresent,
      artifactMissing: isClosed && !artifactPresent,
    });
  }

  // Step 5: separate story headers from task rows
  // Any sprint item that is the parent of ANOTHER sprint item → story header only (not a task row)
  const allItemIdSet = new Set(allItemsRaw.map(t => t.id));
  const storyHeaderIds = new Set(
    allItemsRaw
      .map(t => t.parentId)
      .filter((id): id is number => id !== null && allItemIdSet.has(id))
  );
  // storyHeaderIds = IDs of sprint items that have children in this sprint
  const storyItemMap = new Map<number, DailyTask>(
    allItemsRaw.filter(t => storyHeaderIds.has(t.id)).map(t => [t.id, t])
  );
  // allTasks = only task-level rows (not story headers)
  const allTasks = allItemsRaw.filter(t => !storyHeaderIds.has(t.id));

  // Step 6: group task rows by story
  const byState: Record<string, DailyTask[]> = {};
  for (const t of allTasks) {
    if (!byState[t.lane]) byState[t.lane] = [];
    byState[t.lane].push(t);
  }

  const storyGroupMap = new Map<number | string, StoryGroup>();
  for (const t of allTasks) {
    let key: number | string;
    let storyTitle: string;
    let storyDescription: string;
    let storyId: number | null;

    if (t.parentId !== null && storyItemMap.has(t.parentId)) {
      // Parent is a sprint story item — use its title + description from parentMap
      key = t.parentId;
      storyTitle = storyItemMap.get(t.parentId)!.title;
      storyDescription = parentMap.get(t.parentId)?.description ?? "";
      storyId = t.parentId;
    } else if (t.parentId !== null) {
      // Parent is outside sprint — use parentMap
      key = t.parentId;
      storyTitle = parentMap.get(t.parentId)?.title ?? `#${t.parentId}`;
      storyDescription = parentMap.get(t.parentId)?.description ?? "";
      storyId = t.parentId;
    } else {
      // No parent — standalone task is its own group
      key = `standalone-${t.id}`;
      storyTitle = t.title;
      storyDescription = "";
      storyId = null;
    }

    if (!storyGroupMap.has(key)) {
      storyGroupMap.set(key, { storyId, storyTitle, storyDescription, tasks: [] });
    }
    storyGroupMap.get(key)!.tasks.push(t);
  }
  const byStory = Array.from(storyGroupMap.values())
    .filter(g => g.tasks.length > 0)
    .sort((a, b) => a.storyTitle.localeCompare(b.storyTitle));

  const COMPLETED_LANES = new Set(["Completed", "Closed", "Done", "Resolved"]);
  const closedToday = allTasks.filter(t => t.changedToday && COMPLETED_LANES.has(t.lane));
  const activatedToday = allTasks.filter(t => t.changedToday && t.lane === "In Progress");
  const allClosed = allTasks.filter(t => COMPLETED_LANES.has(t.lane));
  const noArtifact = allClosed.filter(t => t.artifactMissing);

  const stateSummary: Record<string, number> = {};
  for (const t of allTasks) stateSummary[t.lane] = (stateSummary[t.lane] ?? 0) + 1;

  return {
    date: todayStr,
    sprint: currentSprintPath,
    sprintStartDate,
    sprintEndDate,
    allTasks,
    byState,
    byStory,
    closedToday,
    activatedToday,
    allClosed,
    noArtifact,
    stateSummary,
  };
}

function stateBadgeHtml(lane: string): string {
  const colors: Record<string, string> = {
    "To do":       "background:#e8f0fe;color:#1a56db",
    "In Progress": "background:#fef3c7;color:#92400e",
    "In Review":   "background:#ede9fe;color:#5b21b6",
    "Completed":   "background:#d1fae5;color:#065f46",
    "Blocked":     "background:#fee2e2;color:#991b1b",
    "Removed":     "background:#f3f4f6;color:#6b7280",
  };
  const style = colors[lane] ?? "background:#f3f4f6;color:#374151";
  return `<span style="${style};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;white-space:nowrap">${lane}</span>`;
}

async function inferExpectedArtifacts(
  items: Array<{ id: number; title: string; storyTitle: string; storyDescription: string }>,
  client: OpenAI
): Promise<Record<number, string>> {
  if (items.length === 0) return {};
  const list = items.map(i => {
    const storyLine = i.storyDescription
      ? `\n   Story: "${i.storyTitle}"\n   Context: ${i.storyDescription}`
      : i.storyTitle ? `\n   Story: "${i.storyTitle}"` : "";
    return `#${i.id}: "${i.title}"${storyLine}`;
  }).join("\n\n");

  const prompt = `For each work item below, infer the specific deliverable or artifact the team member should produce as evidence of completion.
Return ONLY valid JSON with numeric string keys: { "2164": "Video script Google Doc link", "2163": "Use case document link", ... }
Be specific to the task (e.g. "Loom walkthrough video", "Google Doc with script", "n8n workflow URL", "GitHub PR link", "published LinkedIn post link", "Figma mockup link", "approval screenshot", "exported CSV report").

Work items:
${list}`;

  console.log(`🤖 Inferring artifacts for ${items.length} tasks...`);
  const response = await client.chat.completions.create({
    model: config.openrouter.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 800,
  });
  const raw = response.choices[0]?.message?.content ?? "{}";
  console.log(`   AI raw artifact response (${raw.length} chars):`, raw.substring(0, 200));
  const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  const parsed = JSON.parse(jsonStr);
  const result: Record<number, string> = {};
  for (const [k, v] of Object.entries(parsed)) result[Number(k)] = String(v);
  console.log(`   Mapped ${Object.keys(result).length} artifact hints`);
  return result;
}

async function generateDailyProgressEmail(data: DailyProgressData): Promise<string> {
  const client = new OpenAI({ apiKey: config.openrouter.apiKey, baseURL: config.openrouter.baseUrl });

  // Build per-task context for AI inference (story title + description for each task)
  const taskContexts = data.allTasks.map(t => {
    const group = data.byStory.find(g => g.tasks.some(gt => gt.id === t.id));
    return {
      id: t.id,
      title: t.title,
      storyTitle: group?.storyTitle ?? t.parentTitle ?? "",
      storyDescription: group?.storyDescription ?? "",
    };
  });

  let artifactMap: Record<number, string> = {};
  try {
    artifactMap = await inferExpectedArtifacts(taskContexts, client);
  } catch (e) {
    console.error("⚠️ inferExpectedArtifacts failed:", (e as Error).message);
  }
  for (const t of data.allTasks) t.expectedArtifact = artifactMap[t.id] ?? undefined;

  const sprintName = data.sprint.split("\\").pop() ?? data.sprint;
  const CLOSED_STATES = new Set(["Closed", "Done", "Resolved", "Completed"]);

  // Summary counts
  const totalActive = data.allTasks.filter(t => t.state === "Active").length;
  const totalClosed = data.allTasks.filter(t => CLOSED_STATES.has(t.state)).length;
  const totalMissingArtifact = data.noArtifact.length;

  const summaryCards = [
    { label: "TOTAL", value: data.allTasks.length, color: "#374151" },
    { label: "ACTIVE", value: totalActive, color: "#1a56db" },
    { label: "CLOSED", value: totalClosed, color: "#065f46" },
    { label: "MISSING ARTIFACT", value: totalMissingArtifact, color: totalMissingArtifact > 0 ? "#92400e" : "#065f46" },
  ].map(c =>
    `<td style="text-align:center;padding:12px 20px;border-right:1px solid #e5e7eb">
      <div style="font-size:22px;font-weight:700;color:${c.color}">${c.value}</div>
      <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-top:2px">${c.label}</div>
    </td>`
  ).join("");

  // Taskboard grouped by story
  const taskboardHtml = data.byStory.map(group => {
    const taskRows = group.tasks.map(t => {
      const isClosed = CLOSED_STATES.has(t.state) || t.lane === "Completed" || t.lane === "Blocked";
      const artifactHint = t.expectedArtifact ?? "deliverable link";
      const artifactCell = isClosed
        ? t.artifactMissing
          ? `<td style="font-size:12px;color:#92400e;padding:8px 6px">⚠️ <em>${artifactHint}</em></td>`
          : `<td style="font-size:12px;color:#065f46;padding:8px 6px">✅ artifact present</td>`
        : t.expectedArtifact
          ? `<td style="font-size:12px;color:#9ca3af;padding:8px 6px;font-style:italic">Expected: ${t.expectedArtifact}</td>`
          : `<td></td>`;
      const todayDot = t.changedToday ? ` <span style="background:#fef3c7;color:#92400e;font-size:10px;padding:1px 5px;border-radius:8px">today</span>` : "";
      return `<tr style="border-top:1px solid #f3f4f6">
        <td style="padding:8px 12px;width:80px">${stateBadgeHtml(t.lane)}</td>
        <td style="padding:8px 6px;font-size:11px;color:#9ca3af;width:50px">#${t.id}</td>
        <td style="padding:8px 6px;font-size:13px">${t.title}${todayDot}</td>
        <td style="padding:8px 6px;font-size:12px;color:#6b7280;white-space:nowrap">${t.assignedTo}</td>
        ${artifactCell}
      </tr>`;
    }).join("");

    const descHtml = group.storyDescription
      ? `<div style="font-size:11px;color:#6b7280;margin-top:3px;font-style:italic">${group.storyDescription}</div>`
      : "";

    return `
      <tr><td colspan="5" style="padding:14px 12px 6px;background:#f9fafb;border-top:2px solid #e5e7eb">
        <div style="font-size:13px;font-weight:600;color:#111827">📋 ${group.storyTitle}${group.storyId ? `<span style="color:#9ca3af;font-size:11px;font-weight:400;margin-left:6px">#${group.storyId}</span>` : ""}</div>
        ${descHtml}
      </td></tr>
      ${taskRows}`;
  }).join("");

  // Today's activity section
  const todayItems = data.allTasks.filter(t => t.changedToday);
  const todayRows = todayItems.map(t => {
    const isClosed = CLOSED_STATES.has(t.state);
    const badge = isClosed
      ? `<span style="color:#065f46;font-weight:600">✓ Closed</span>`
      : `<span style="color:#1a56db;font-weight:600">▶ Started</span>`;
    return `<tr style="border-top:1px solid #f3f4f6">
      <td style="padding:7px 12px;width:80px">${badge}</td>
      <td style="padding:7px 6px;font-size:11px;color:#9ca3af">#${t.id}</td>
      <td style="padding:7px 6px;font-size:13px">${t.title}</td>
      <td style="padding:7px 6px;font-size:12px;color:#6b7280">${t.assignedTo}</td>
      <td style="padding:7px 6px;font-size:12px;color:#6b7280">${t.parentTitle ?? ""}</td>
    </tr>`;
  }).join("");

  // Missing artifacts
  const artifactRows = data.noArtifact.map(t =>
    `<tr style="border-top:1px solid #fef3c7">
      <td style="padding:8px 12px;font-size:12px;color:#6b7280">#${t.id}</td>
      <td style="padding:8px 6px;font-size:13px">${t.title}</td>
      <td style="padding:8px 6px;font-size:12px;color:#6b7280">${t.assignedTo}</td>
      <td style="padding:8px 6px;font-size:12px;color:#6b7280">${t.parentTitle ?? ""}</td>
      <td style="padding:8px 6px;font-size:12px;color:#92400e">Expected: <em>${t.expectedArtifact}</em></td>
    </tr>`
  ).join("");

  const fontStack = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

  return `<div style="${fontStack};max-width:860px;margin:0 auto;color:#111827">

  <h2 style="margin:0 0 4px">Daily Sprint Progress</h2>
  <p style="margin:0 0 16px;color:#6b7280;font-size:13px">
    <strong>Sprint:</strong> ${sprintName} &nbsp;|
    <strong>Date:</strong> ${data.date} &nbsp;|
    <strong>Sprint Dates:</strong> ${data.sprintStartDate ?? "?"} → ${data.sprintEndDate ?? "?"}
  </p>

  <table style="border:1px solid #e5e7eb;border-radius:8px;border-collapse:collapse;width:100%;margin-bottom:24px">
    <tr>${summaryCards}</tr>
  </table>

  <h3 style="margin:0 0 10px;font-size:15px">Sprint Taskboard <span style="color:#6b7280;font-weight:400;font-size:12px">(Active &amp; Closed)</span></h3>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:28px">
    ${taskboardHtml}
  </table>

  <h3 style="margin:0 0 8px;font-size:15px">Today's Activity
    <span style="color:#6b7280;font-weight:400;font-size:12px;margin-left:6px">${data.closedToday.length} closed · ${data.activatedToday.length} started</span>
  </h3>
  ${todayItems.length > 0
    ? `<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:28px">${todayRows}</table>`
    : `<p style="color:#6b7280;font-size:13px;margin-bottom:28px">No state changes recorded today yet.</p>`
  }

  ${data.noArtifact.length > 0 ? `
  <h3 style="margin:0 0 6px;font-size:15px;color:#92400e">⚠️ Closed Without Artifact
    <span style="color:#6b7280;font-weight:400;font-size:12px;margin-left:6px">${data.noArtifact.length} task${data.noArtifact.length !== 1 ? "s" : ""} need follow-up</span>
  </h3>
  <p style="font-size:12px;color:#6b7280;margin:0 0 8px">Please add a comment with the deliverable link on each of these tasks.</p>
  <table style="width:100%;border-collapse:collapse;border:1px solid #fde68a;border-radius:8px;background:#fffbeb;margin-bottom:24px">
    <tr style="background:#fef3c7">
      <th style="padding:8px 12px;text-align:left;font-size:11px;color:#92400e">#</th>
      <th style="padding:8px 6px;text-align:left;font-size:11px;color:#92400e">Task</th>
      <th style="padding:8px 6px;text-align:left;font-size:11px;color:#92400e">Assignee</th>
      <th style="padding:8px 6px;text-align:left;font-size:11px;color:#92400e">Story</th>
      <th style="padding:8px 6px;text-align:left;font-size:11px;color:#92400e">Expected Artifact</th>
    </tr>${artifactRows}
  </table>` : `<p style="color:#065f46;font-size:13px">✅ All closed tasks have artifacts — great work!</p>`}

</div>`;
}

async function runDailyReport(): Promise<void> {
  console.log("═══════════════════════════════════════════");
  console.log("  📅 Daily Sprint Progress Report         ");
  console.log("═══════════════════════════════════════════\n");

  try {
    console.log("📡 Reading sprint taskboard...");
    const data = await fetchDailyProgressData();
    const stateStr = Object.entries(data.stateSummary).map(([s, n]) => `${s}: ${n}`).join(", ");
    console.log(`✅ Sprint: ${data.sprint}`);
    console.log(`   Tasks: ${data.allTasks.length} total — ${stateStr}`);
    console.log(`   Closed today: ${data.closedToday.length} | Started today: ${data.activatedToday.length}`);
    console.log(`   Missing artifacts: ${data.noArtifact.length}\n`);

    console.log("🤖 Generating daily progress email...");
    console.log(`🤖 Model: ${config.openrouter.model}`);
    const emailHtml = await generateDailyProgressEmail(data);
    console.log(`✅ Daily email generated (${emailHtml.length} chars)\n`);

    const subject = `📅 Daily Sprint Progress — ${data.sprint} — ${data.date}`;
    const result = await sendEmail(emailHtml, subject);

    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  Result: ${result.status}`);
    if (result.path) console.log(`  File: ${result.path}`);
    if (result.error) console.log(`  Error: ${result.error}`);
    console.log(`═══════════════════════════════════════════`);
  } catch (err) {
    const error = err as Error;
    console.error(`\n❌ FATAL ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

const isDailyMode = process.argv.includes("--daily");
if (isDailyMode) {
  runDailyReport().catch(err => { console.error("Unhandled error:", err); process.exit(1); });
} else {
  main().catch(err => { console.error("Unhandled error:", err); process.exit(1); });
}

