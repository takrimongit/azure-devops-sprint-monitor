const { WebApi, getPersonalAccessTokenHandler } = require("azure-devops-node-api");
const OpenAI = require("openai");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// Load environment variables
require("dotenv").config();
// Also try to load from Hermes env
const hermesEnvPath = path.join(process.env.HOME || "~", ".hermes", ".env");
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
// CONFIGURATION
// ============================================================
const config = {
  azureDevOps: {
    orgUrl: process.env.AZURE_DEVOPS_ORG_URL || "https://dev.azure.com/HelpablesOrg",
    project: process.env.AZURE_DEVOPS_PROJECT || "aidapp",
    pat: process.env.AZURE_DEVOPS_PAT || "",
  },
  email: {
    to: process.env.EMAIL_TO || "anam@helpables.org,cliqueadmin@helpables.org",
    from: process.env.EMAIL_FROM || "rookie-agent@hermes",
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    baseUrl: "https://openrouter.ai/api/v1",
    model: process.env.AI_MODEL || "qwen/qwen3-coder",
  },
};

// ============================================================
// 1. FETCH SPRINT DATA FROM AZURE DEVOPS
// ============================================================
async function fetchSprintData() {
  const authHandler = getPersonalAccessTokenHandler(config.azureDevOps.pat);
  const webApi = new WebApi(config.azureDevOps.orgUrl, authHandler);
  const witApi = await webApi.getWorkItemTrackingApi();
  const project = config.azureDevOps.project;

  console.log("📡 Fetching sprint data from Azure DevOps...");

  // Get all tasks (including Closed/Done) for accurate sprint metrics
  const wiql = {
    query: `Select [System.Id], [System.Title], [System.State], [System.AssignedTo], 
            [System.IterationPath], [System.ChangedDate], [System.ChangedBy], [System.CreatedDate]
            From WorkItems 
            Where [System.WorkItemType] = 'Task' 
              And [System.TeamProject] = '${project}'`
  };

  const wiqlResult = await witApi.queryByWiql(wiql, { project });
  if (!wiqlResult.workItems || wiqlResult.workItems.length === 0) {
    return { tasks: [], sprints: [], metadata: {} };
  }

  // Fetch batch details
  const ids = wiqlResult.workItems.map(item => item.id);
  const allWorkItems = [];
  const batchSize = 200;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = await witApi.getWorkItems(ids.slice(i, i + batchSize));
    if (batch) allWorkItems.push(...batch);
  }

  // Group by iteration path (sprint)
  const sprintMap = new Map();
  const personMap = new Map();
  const now = new Date();

  allWorkItems.forEach(wi => {
    const fields = wi.fields || {};
    const iterationPath = fields["System.IterationPath"] || "Unassigned";
    const state = fields["System.State"] || "Unknown";
    const title = fields["System.Title"] || "";
    const assignedTo = fields["System.AssignedTo"]?.displayName || "Unassigned";
    const changedDate = fields["System.ChangedDate"] ? new Date(fields["System.ChangedDate"]) : null;
    const createdDate = fields["System.CreatedDate"] ? new Date(fields["System.CreatedDate"]) : null;

    const task = {
      id: wi.id,
      title,
      state,
      assignedTo,
      iterationPath,
      changedDate,
      createdDate,
      daysSinceChange: changedDate ? Math.floor((now - changedDate) / (1000 * 60 * 60 * 24)) : null,
      daysSinceCreated: createdDate ? Math.floor((now - createdDate) / (1000 * 60 * 60 * 24)) : null,
    };

    // Sprint grouping
    if (!sprintMap.has(iterationPath)) {
      sprintMap.set(iterationPath, { name: iterationPath, tasks: [], stateCounts: {} });
    }
    const sprint = sprintMap.get(iterationPath);
    sprint.tasks.push(task);
    sprint.stateCounts[state] = (sprint.stateCounts[state] || 0) + 1;

    // Person grouping
    if (!personMap.has(assignedTo)) {
      personMap.set(assignedTo, { name: assignedTo, taskCount: 0, activeTasks: 0, newTasks: 0 });
    }
    const person = personMap.get(assignedTo);
    person.taskCount++;
    if (state === "Active") person.activeTasks++;
    if (state === "New") person.newTasks++;
  });

  // Identify current and last sprint by most recent activity
  const sprints = Array.from(sprintMap.values());
  sprints.forEach(s => {
    s.latestActivity = s.tasks.reduce((max, t) => {
      return t.changedDate && (!max || t.changedDate > max) ? t.changedDate : max;
    }, null);
  });
  sprints.sort((a, b) => {
    const da = a.latestActivity ? a.latestActivity.getTime() : 0;
    const db = b.latestActivity ? b.latestActivity.getTime() : 0;
    return db - da;
  });

  const currentSprint = sprints[0] || null;
  const lastSprint = sprints[1] || null;

  return {
    tasks: allWorkItems.map(wi => ({
      id: wi.id,
      title: wi.fields?.["System.Title"] || "",
      state: wi.fields?.["System.State"] || "Unknown",
      assignedTo: wi.fields?.["System.AssignedTo"]?.displayName || "Unassigned",
      iterationPath: wi.fields?.["System.IterationPath"] || "Unassigned",
      changedDate: wi.fields?.["System.ChangedDate"] ? new Date(wi.fields["System.ChangedDate"]).toISOString() : null,
      createdDate: wi.fields?.["System.CreatedDate"] ? new Date(wi.fields["System.CreatedDate"]).toISOString() : null,
      daysSinceChange: wi.fields?.["System.ChangedDate"]
        ? Math.floor((now - new Date(wi.fields["System.ChangedDate"])) / (1000 * 60 * 60 * 24))
        : null,
    })),
    sprints,
    currentSprint,
    lastSprint,
    people: Array.from(personMap.values()),
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
function evaluateHygiene(data) {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "rules", "sprint-hygiene-rules.json"), "utf-8"));
  const findings = [];

  if (!data.currentSprint) {
    findings.push({ ruleId: "NO_CURRENT_SPRINT", severity: "CRITICAL", message: "No current sprint identified", details: "Could not determine the active sprint." });
    return findings;
  }

  const currentSprint = data.currentSprint;
  const lastSprint = data.lastSprint;
  const now = new Date();

  // Analyze current sprint (always)
  analyzeSprint(currentSprint, "Current Sprint", rules, findings, now);

  // Analyze last sprint for comparison (findings from last sprint included too)
  if (lastSprint) {
    analyzeSprint(lastSprint, "Last Sprint", rules, findings, now);
    checkCarryOver(currentSprint, lastSprint, findings);
  }

  // Compute health grade using stricter rules from JSON
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

  // Collect person breakdown from all analyzed sprints
  const allPersonBreakdown = {};
  if (currentSprint.metrics?.personBreakdown) {
    Object.entries(currentSprint.metrics.personBreakdown).forEach(([person, count]) => {
      allPersonBreakdown[person] = (allPersonBreakdown[person] || 0) + count;
    });
  }

  const people = data.people || [];
  const teamMembers = new Set([...Object.keys(allPersonBreakdown), ...people.map(p => p.name)]);

  return {
    findings,
    grade,
    gradeLabel,
    summary: {
      currentSprint: currentSprint.name,
      currentSprintMetrics: currentSprint.metrics || {},
      lastSprint: lastSprint ? lastSprint.name : "N/A",
      lastSprintMetrics: lastSprint ? (lastSprint.metrics || {}) : {},
      totalTasksCurrent: currentSprint.metrics?.totalTasks || currentSprint.tasks.length,
      activeTasksCurrent: currentSprint.metrics?.activeTasks || 0,
      newTasksCurrent: currentSprint.metrics?.newTasks || 0,
      closedTasksCurrent: currentSprint.metrics?.closedTasks || 0,
      criticalIssues: criticals,
      warnings,
      teamMembers: teamMembers.size,
      personBreakdown: allPersonBreakdown,
    }
  };
}

function analyzeSprint(sprint, sprintLabel, rules, findings, now) {
  if (!sprint || !sprint.tasks || sprint.tasks.length === 0) return;

  const tasks = sprint.tasks;
  const totalTasks = tasks.length;
  const activeTasks = tasks.filter(t => t.state === "Active");
  const newTasks = tasks.filter(t => t.state === "New");
  const closedTasks = tasks.filter(t => t.state === "Closed");
  const removedTasks = tasks.filter(t => t.state === "Removed");

  // 1. WIP_LIMIT - Max 2 active per person (warning), 3+ (critical)
  const wipRule = rules.rules.find(r => r.id === "WIP_LIMIT");
  const personActiveCounts = {};
  activeTasks.forEach(t => {
    personActiveCounts[t.assignedTo] = (personActiveCounts[t.assignedTo] || 0) + 1;
  });
  for (const [person, count] of Object.entries(personActiveCounts)) {
    if (count >= wipRule.critical_threshold) {
      findings.push({
        ruleId: "WIP_LIMIT",
        severity: "CRITICAL",
        message: `${person} has ${count} active tasks (${sprintLabel})`,
        details: `Exceeds critical threshold of ${wipRule.critical_threshold} active tasks per person. This indicates context switching and potential burnout risk.`
      });
    } else if (count >= wipRule.warning_threshold) {
      findings.push({
        ruleId: "WIP_LIMIT",
        severity: "WARNING",
        message: `${person} has ${count} active tasks (${sprintLabel})`,
        details: `Exceeds warning threshold of ${wipRule.warning_threshold} active tasks per person.`
      });
    }
  }

  // 2. TASK_STALENESS - 3+ days (warning), 5+ days (critical)
  const stalenessRule = rules.rules.find(r => r.id === "TASK_STALENESS");
  const staleTasks = tasks.filter(t => t.daysSinceChange !== null && t.daysSinceChange > stalenessRule.warning_threshold);
  const criticalStale = staleTasks.filter(t => t.daysSinceChange > stalenessRule.critical_threshold);
  
  if (criticalStale.length > 0) {
    findings.push({
      ruleId: "TASK_STALENESS",
      severity: "CRITICAL",
      message: `${criticalStale.length} tasks untouched for >${stalenessRule.critical_threshold} days (${sprintLabel})`,
      details: criticalStale.slice(0, 10).map(t => `#${t.id}: ${t.title} (${t.daysSinceChange} days, ${t.state})`).join("\n")
    });
  } else if (staleTasks.length > 0) {
    findings.push({
      ruleId: "TASK_STALENESS",
      severity: "WARNING",
      message: `${staleTasks.length} tasks untouched for >${stalenessRule.warning_threshold} days (${sprintLabel})`,
      details: staleTasks.slice(0, 10).map(t => `#${t.id}: ${t.title} (${t.daysSinceChange} days, ${t.state})`).join("\n")
    });
  }

  // 3. UNASSIGNED_TASKS - 0 unassigned (warning), >10% unassigned (critical)
  const unassignedRule = rules.rules.find(r => r.id === "UNASSIGNED_TASKS");
  const unassignedTasks = tasks.filter(t => t.assignedTo === "Unassigned" && (t.state === "Active" || t.state === "New"));
  const unassignedPct = (unassignedTasks.length / totalTasks) * 100;
  
  if (unassignedPct > unassignedRule.critical_threshold) {
    findings.push({
      ruleId: "UNASSIGNED_TASKS",
      severity: "CRITICAL",
      message: `${unassignedTasks.length} unassigned tasks (${sprintLabel})`,
      details: `${unassignedPct.toFixed(1)}% of tasks have no owner. This indicates poor sprint planning. Every task must have a clear owner.`
    });
  } else if (unassignedTasks.length > unassignedRule.warning_threshold) {
    findings.push({
      ruleId: "UNASSIGNED_TASKS",
      severity: "WARNING",
      message: `${unassignedTasks.length} unassigned tasks (${sprintLabel})`,
      details: `Tasks without owners: ${unassignedTasks.slice(0, 5).map(t => `#${t.id}: ${t.title}`).join(", ")}`
    });
  }

  // 4. SPRINT_COMPLETION_RATE - <40% closed (warning), <20% closed (critical)
  const completionRule = rules.rules.find(r => r.id === "SPRINT_COMPLETION_RATE");
  const completionPct = (closedTasks.length / totalTasks) * 100;
  
  if (completionPct < completionRule.critical_threshold) {
    findings.push({
      ruleId: "SPRINT_COMPLETION_RATE",
      severity: "CRITICAL",
      message: `Only ${completionPct.toFixed(1)}% of tasks completed (${sprintLabel})`,
      details: `${closedTasks.length}/${totalTasks} tasks closed. Sprint execution is severely behind schedule.`
    });
  } else if (completionPct < completionRule.warning_threshold) {
    findings.push({
      ruleId: "SPRINT_COMPLETION_RATE",
      severity: "WARNING",
      message: `Only ${completionPct.toFixed(1)}% of tasks completed (${sprintLabel})`,
      details: `${closedTasks.length}/${totalTasks} tasks closed. Sprint is at risk of not meeting goals.`
    });
  }

  // 5. NEW_TASK_RATIO - >50% new (warning), >70% new (critical)
  const newTaskRule = rules.rules.find(r => r.id === "NEW_TASK_RATIO");
  const newTaskPct = (newTasks.length / totalTasks) * 100;
  
  if (newTaskPct > newTaskRule.critical_threshold) {
    findings.push({
      ruleId: "NEW_TASK_RATIO",
      severity: "CRITICAL",
      message: `${newTaskPct.toFixed(1)}% of tasks still in New state (${sprintLabel})`,
      details: `${newTasks.length}/${totalTasks} tasks haven't been started. This indicates poor sprint execution and lack of momentum.`
    });
  } else if (newTaskPct > newTaskRule.warning_threshold) {
    findings.push({
      ruleId: "NEW_TASK_RATIO",
      severity: "WARNING",
      message: `${newTaskPct.toFixed(1)}% of tasks still in New state (${sprintLabel})`,
      details: `${newTasks.length}/${totalTasks} tasks haven't been started. Sprint needs to accelerate task pickup.`
    });
  }

  // 6. TASK_AGING_NEW - Average 3+ days in New (warning), 7+ days (critical)
  const agingNewRule = rules.rules.find(r => r.id === "TASK_AGING_NEW");
  if (newTasks.length > 0) {
    const avgDaysInNew = newTasks.reduce((sum, t) => sum + (t.daysSinceCreated || 0), 0) / newTasks.length;
    
    if (avgDaysInNew > agingNewRule.critical_threshold) {
      findings.push({
        ruleId: "TASK_AGING_NEW",
        severity: "CRITICAL",
        message: `Tasks sitting in New state average ${avgDaysInNew.toFixed(1)} days (${sprintLabel})`,
        details: `Tasks are not being picked up. Current average: ${avgDaysInNew.toFixed(1)} days (threshold: ${agingNewRule.critical_threshold} days).`
      });
    } else if (avgDaysInNew > agingNewRule.warning_threshold) {
      findings.push({
        ruleId: "TASK_AGING_NEW",
        severity: "WARNING",
        message: `Tasks sitting in New state average ${avgDaysInNew.toFixed(1)} days (${sprintLabel})`,
        details: `Tasks should be picked up faster. Current average: ${avgDaysInNew.toFixed(1)} days (threshold: ${agingNewRule.warning_threshold} days).`
      });
    }
  }

  // 7. TASK_AGING_ACTIVE - Average 5+ days in Active (warning), 10+ days (critical)
  const agingActiveRule = rules.rules.find(r => r.id === "TASK_AGING_ACTIVE");
  if (activeTasks.length > 0) {
    const avgDaysInActive = activeTasks.reduce((sum, t) => sum + (t.daysSinceChange || 0), 0) / activeTasks.length;
    
    if (avgDaysInActive > agingActiveRule.critical_threshold) {
      findings.push({
        ruleId: "TASK_AGING_ACTIVE",
        severity: "CRITICAL",
        message: `Active tasks average ${avgDaysInActive.toFixed(1)} days without progress (${sprintLabel})`,
        details: `Tasks are stalled. Current average: ${avgDaysInActive.toFixed(1)} days (threshold: ${agingActiveRule.critical_threshold} days). This indicates blocked work or lack of execution.`
      });
    } else if (avgDaysInActive > agingActiveRule.warning_threshold) {
      findings.push({
        ruleId: "TASK_AGING_ACTIVE",
        severity: "WARNING",
        message: `Active tasks average ${avgDaysInActive.toFixed(1)} days without progress (${sprintLabel})`,
        details: `Tasks should complete faster. Current average: ${avgDaysInActive.toFixed(1)} days (threshold: ${agingActiveRule.warning_threshold} days).`
      });
    }
  }

  // 8. UNCLEAR_TITLES - >5% unclear (warning), >15% unclear (critical)
  const unclearRule = rules.rules.find(r => r.id === "UNCLEAR_TITLES");
  const unclearPatterns = unclearRule.unclear_patterns.map(p => p.toLowerCase());
  const unclearTasks = tasks.filter(t => 
    unclearPatterns.some(p => t.title.toLowerCase().includes(p))
  );
  const unclearPct = (unclearTasks.length / totalTasks) * 100;
  
  if (unclearPct > unclearRule.critical_threshold) {
    findings.push({
      ruleId: "UNCLEAR_TITLES",
      severity: "CRITICAL",
      message: `${unclearPct.toFixed(1)}% of tasks have unclear titles (${sprintLabel})`,
      details: `${unclearTasks.length}/${totalTasks} tasks. Poor planning: ${unclearTasks.slice(0, 5).map(t => `#${t.id}: "${t.title}"`).join(", ")}`
    });
  } else if (unclearPct > unclearRule.warning_threshold) {
    findings.push({
      ruleId: "UNCLEAR_TITLES",
      severity: "WARNING",
      message: `${unclearPct.toFixed(1)}% of tasks have unclear titles (${sprintLabel})`,
      details: `${unclearTasks.length}/${totalTasks} tasks: ${unclearTasks.slice(0, 5).map(t => `#${t.id}: "${t.title}"`).join(", ")}`
    });
  }

  // 9. WORKLOAD_BALANCE - Check for imbalance (2x average warning, 0.4x underutilized)
  const workloadRule = rules.rules.find(r => r.id === "WORKLOAD_BALANCE");
  const personTaskCounts = {};
  tasks.forEach(t => {
    personTaskCounts[t.assignedTo] = (personTaskCounts[t.assignedTo] || 0) + 1;
  });
  const totalPeople = Object.keys(personTaskCounts).length;
  if (totalPeople > 1) {
    const avgTasksPerPerson = totalTasks / totalPeople;
    const overloaded = Object.entries(personTaskCounts)
      .filter(([_, count]) => count > avgTasksPerPerson * workloadRule.warning_threshold_multiplier);
    const underutilized = Object.entries(personTaskCounts)
      .filter(([_, count]) => count < avgTasksPerPerson * workloadRule.underutilized_threshold_multiplier);
    
    if (overloaded.length > 0) {
      findings.push({
        ruleId: "WORKLOAD_BALANCE",
        severity: "WARNING",
        message: `${overloaded.length} team members are overloaded (${sprintLabel})`,
        details: `Overloaded (>2x average): ${overloaded.map(([person, count]) => `${person}: ${count} tasks`).join(", ")}. Average: ${avgTasksPerPerson.toFixed(1)} tasks/person.`
      });
    }
    if (underutilized.length > 0) {
      findings.push({
        ruleId: "WORKLOAD_BALANCE",
        severity: "WARNING",
        message: `${underutilized.length} team members are underutilized (${sprintLabel})`,
        details: `Underutilized (<40% average): ${underutilized.map(([person, count]) => `${person}: ${count} tasks`).join(", ")}. Average: ${avgTasksPerPerson.toFixed(1)} tasks/person.`
      });
    }
  }

  // 10. ZERO_ACTIVITY_PERSONS - Team members with 0 tasks in sprint
  const zeroActivityRule = rules.rules.find(r => r.id === "ZERO_ACTIVITY_PERSONS");
  const inactiveMembers = Object.entries(personTaskCounts).filter(([_, count]) => count === 0);
  
  if (inactiveMembers.length > 0) {
    findings.push({
      ruleId: "ZERO_ACTIVITY_PERSONS",
      severity: "WARNING",
      message: `${inactiveMembers.length} team members have zero tasks in ${sprintLabel}`,
      details: `Inactive: ${inactiveMembers.map(([person, _]) => person).join(", ")}. This indicates poor resource utilization.`
    });
  }

  // 11. SPRINT_SCOPE_CREEP - Tasks created after sprint start (>10% warning, >25% critical)
  const scopeCreepRule = rules.rules.find(r => r.id === "SPRINT_SCOPE_CREEP");
  // Use earliest task creation date as proxy for sprint start
  const createdDates = tasks.filter(t => t.createdDate).map(t => new Date(t.createdDate)).sort((a, b) => a - b);
  if (createdDates.length >= 2) {
    const sprintStart = createdDates[0];
    // Consider tasks created >2 days after sprint start as mid-sprint additions
    const scopeBoundary = new Date(sprintStart.getTime() + 2 * 24 * 60 * 60 * 1000);
    const midSprintTasks = tasks.filter(t => t.createdDate && new Date(t.createdDate) > scopeBoundary);
    const midSprintPct = (midSprintTasks.length / totalTasks) * 100;
    
    if (midSprintPct > scopeCreepRule.critical_threshold) {
      findings.push({
        ruleId: "SPRINT_SCOPE_CREEP",
        severity: "CRITICAL",
        message: `${midSprintPct.toFixed(1)}% of tasks added mid-sprint (${sprintLabel})`,
        details: `${midSprintTasks.length}/${totalTasks} tasks created after sprint started (${sprintStart.toISOString().split("T")[0]}). This indicates poor sprint planning and scope creep.`
      });
    } else if (midSprintPct > scopeCreepRule.warning_threshold) {
      findings.push({
        ruleId: "SPRINT_SCOPE_CREEP",
        severity: "WARNING",
        message: `${midSprintPct.toFixed(1)}% of tasks added mid-sprint (${sprintLabel})`,
        details: `${midSprintTasks.length}/${totalTasks} tasks created after sprint started (${sprintStart.toISOString().split("T")[0]}).`
      });
    }
  }

  // 12. SINGLE_PERSON_DEPENDENCY - >40% tasks on one person (warning), >55% (critical)
  const singlePersonRule = rules.rules.find(r => r.id === "SINGLE_PERSON_DEPENDENCY");
  const maxPersonLoad = Math.max(...Object.values(personTaskCounts));
  const maxPersonShare = (maxPersonLoad / totalTasks) * 100;
  const maxPerson = Object.entries(personTaskCounts).find(([_, count]) => count === maxPersonLoad)?.[0];
  
  if (maxPersonShare > singlePersonRule.critical_threshold) {
    findings.push({
      ruleId: "SINGLE_PERSON_DEPENDENCY",
      severity: "CRITICAL",
      message: `${maxPerson} carries ${maxPersonShare.toFixed(1)}% of sprint tasks (${sprintLabel})`,
      details: `${maxPersonLoad}/${totalTasks} tasks. This is a bus factor risk. Sprint is overly dependent on one person.`
    });
  } else if (maxPersonShare > singlePersonRule.warning_threshold) {
    findings.push({
      ruleId: "SINGLE_PERSON_DEPENDENCY",
      severity: "WARNING",
      message: `${maxPerson} carries ${maxPersonShare.toFixed(1)}% of sprint tasks (${sprintLabel})`,
      details: `${maxPersonLoad}/${totalTasks} tasks. Consider redistributing work.`
    });
  }

  // Store sprint metrics for the email
  sprint.metrics = {
    totalTasks,
    activeTasks: activeTasks.length,
    newTasks: newTasks.length,
    closedTasks: closedTasks.length,
    removedTasks: removedTasks.length,
    completionPct,
    newTaskPct,
    avgDaysInNew: newTasks.length > 0 ? (newTasks.reduce((sum, t) => sum + (t.daysSinceCreated || 0), 0) / newTasks.length) : 0,
    avgDaysInActive: activeTasks.length > 0 ? (activeTasks.reduce((sum, t) => sum + (t.daysSinceChange || 0), 0) / activeTasks.length) : 0,
    personBreakdown: personTaskCounts,
  };
}

function checkCarryOver(currentSprint, lastSprint, findings) {
  const carryOverRule = { warning_threshold: 15, critical_threshold: 30 };
  
  // Count tasks in current sprint that were also in last sprint (not closed in last sprint)
  const lastSprintTaskIds = new Set(lastSprint.tasks.filter(t => t.state !== "Closed").map(t => t.id));
  const carryOverTasks = currentSprint.tasks.filter(t => lastSprintTaskIds.has(t.id));
  const carryOverPct = currentSprint.tasks.length > 0 ? (carryOverTasks.length / currentSprint.tasks.length) * 100 : 0;
  
  if (carryOverPct > carryOverRule.critical_threshold) {
    findings.push({
      ruleId: "CARRY_OVER",
      severity: "CRITICAL",
      message: `${carryOverPct.toFixed(1)}% of current sprint is carry-over from last sprint`,
      details: `${carryOverTasks.length}/${currentSprint.tasks.length} tasks carried over. Last sprint failed to complete its work. This indicates poor sprint execution and planning.`
    });
  } else if (carryOverPct > carryOverRule.warning_threshold) {
    findings.push({
      ruleId: "CARRY_OVER",
      severity: "WARNING",
      message: `${carryOverPct.toFixed(1)}% of current sprint is carry-over from last sprint`,
      details: `${carryOverTasks.length}/${currentSprint.tasks.length} tasks carried over from last sprint.`
    });
  }
}

// ============================================================
// 2.5 SEMANTIC WORK QUALITY ANALYSIS (Stage 1: Gemini)
// ============================================================
async function analyzeWorkQuality(data) {
  console.log("🧠 Running semantic work quality analysis (Gemini 2.5 Pro)...");

  const client = new OpenAI({
    apiKey: config.openrouter.apiKey,
    baseURL: config.openrouter.baseUrl,
  });

  const currentSprint = data.currentSprint;
  const lastSprint = data.lastSprint;

  // Build task list for current sprint
  const currentTasks = currentSprint.tasks.map(t => ({
    id: t.id,
    title: t.title,
    state: t.state,
    assignedTo: t.assignedTo,
  }));

  const lastTasks = lastSprint ? lastSprint.tasks.map(t => ({
    id: t.id,
    title: t.title,
    state: t.state,
    assignedTo: t.assignedTo,
  })) : [];

  const prompt = `You are a senior software engineering manager evaluating sprint task quality. Your job is to assess whether the tasks make sense as real engineering work.

CURRENT SPRINT: ${currentSprint.name}
Tasks (${currentTasks.length} total):
${currentTasks.map(t => `#${t.id} [${t.state}] (${t.assignedTo}): ${t.title}`).join("\n")}

${lastSprint ? `LAST SPRINT: ${lastSprint.name}
Tasks (${lastTasks.length} total):
${lastTasks.map(t => `#${t.id} [${t.state}] (${t.assignedTo}): ${t.title}`).join("\n")}` : ""}

Evaluate each task and provide a JSON response with this exact structure:
{
  "sprintSummary": "2-3 sentence summary of what this sprint is actually trying to accomplish",
  "taskQuality": "overall assessment: good/fair/poor",
  "problematicTasks": [
    {
      "id": 123,
      "title": "task title",
      "issues": ["list of specific problems"],
      "severity": "warning or critical"
    }
  ],
  "duplicateOrOverlapping": [
    {
      "ids": [123, 456],
      "reason": "why these appear to overlap"
    }
  ],
  "unclearWork": [
    {
      "id": 123,
      "title": "task title",
      "problem": "why the actual work is unclear"
    }
  ],
  "strengths": ["list of well-defined, clear tasks or patterns"]
}

For EACH task, evaluate:
1. **Clarity**: Is the title clear and specific? (Not generic like "Update X", "Fix bugs", "Work on Y")
2. **Actionability**: Can you understand what concrete work needs to be done?
3. **Scope**: Is the task appropriately scoped (not too vague, not too broad)?
4. **Definition of Done**: Does the title imply a clear completion criteria?
5. **Engineering Context**: Does it make sense as software engineering work?

Flag as CRITICAL if:
- Title is completely meaningless or nonsensical
- Task doesn't specify what work is being done
- Obvious duplicate or redundant work
- Task title suggests no real engineering value

Flag as WARNING if:
- Title is vague but somewhat understandable
- Task is too broad or poorly scoped
- Missing specificity on deliverables
- Generic titles that don't explain the actual change

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

  const content = response.choices[0]?.message?.content || "{}";
  try {
    return JSON.parse(content);
  } catch (e) {
    console.error("Failed to parse Gemini response:", e.message);
    return { error: "Failed to parse semantic analysis", raw: content };
  }
}
// ============================================================
async function generateEmail(data, hygieneResult) {
  console.log("🤖 Generating AI-powered email report...");

  const client = new OpenAI({
    apiKey: config.openrouter.apiKey,
    baseURL: config.openrouter.baseUrl,
  });

  const rulesDoc = fs.readFileSync(path.join(__dirname, "..", "rules", "sprint-hygiene-rules.md"), "utf-8");

  const prompt = `You are a stern, no-nonsense sprint health analyst. You are NOT forgiving — you call out problems directly and hold teams to high standards.

Write a professional but firm HTML email report for the team. Focus ONLY on the current sprint and last sprint. Do NOT reference older sprints.

Structure:
1. **Executive Summary** — Sprint health grade with blunt assessment. Start by explaining what the sprint is ACTUALLY trying to achieve (from semantic summary below)
2. **🧠 Work Quality Assessment** — Whether the tasks make sense as real engineering work (from semantic analysis)
3. **🔴 Critical Issues** — Problems requiring immediate action (if any)
4. **🟡 Warnings** — Issues that need attention (if any)
5. **🟢 What's Working** — Only mention if genuinely strong (don't pad with fluff)
6. **Team Breakdown** — Per-person metrics with accountability
7. **Current vs Last Sprint** — Compare progress explicitly
8. **Required Actions** — Specific, prioritized next steps with owners

Be direct. Use 🔴 for critical, 🟡 for warnings, 🟢 for good. No sugarcoating.
If the sprint is failing, say it's failing. If execution is poor, say it's poor.
If tasks don't make sense as real engineering work, call it out.

## Semantic Analysis (Work Quality)
Sprint Summary: ${hygieneResult.semanticAnalysis?.sprintSummary || "Not available"}
Overall Task Quality: ${hygieneResult.semanticAnalysis?.taskQuality || "Not assessed"}
Strengths: ${(hygieneResult.semanticAnalysis?.strengths || []).join("; ") || "None identified"}

## Current Sprint: ${hygieneResult.summary.currentSprint}
- Total Tasks: ${hygieneResult.summary.totalTasksCurrent}
- Active: ${hygieneResult.summary.activeTasksCurrent}
- New: ${hygieneResult.summary.newTasksCurrent}
- Closed: ${hygieneResult.summary.closedTasksCurrent}
- Completion Rate: ${hygieneResult.summary.currentSprintMetrics.completionPct?.toFixed(1) || "N/A"}%
- New Task Ratio: ${hygieneResult.summary.currentSprintMetrics.newTaskPct?.toFixed(1) || "N/A"}%
- Avg Days in New: ${hygieneResult.summary.currentSprintMetrics.avgDaysInNew?.toFixed(1) || "0"}
- Avg Days in Active: ${hygieneResult.summary.currentSprintMetrics.avgDaysInActive?.toFixed(1) || "0"}

## Last Sprint: ${hygieneResult.summary.lastSprint}
${hygieneResult.summary.lastSprintMetrics.totalTasks ? `- Total Tasks: ${hygieneResult.summary.lastSprintMetrics.totalTasks}
- Completion Rate: ${hygieneResult.summary.lastSprintMetrics.completionPct?.toFixed(1) || "N/A"}%` : "- No data available"}

## Health Grade: ${hygieneResult.grade} (${hygieneResult.gradeLabel})
- Critical Issues: ${hygieneResult.summary.criticalIssues}
- Warnings: ${hygieneResult.summary.warnings}

## Findings
${hygieneResult.findings.length > 0 ? hygieneResult.findings.map(f => `[${f.severity}] ${f.ruleId}: ${f.message}\\n  ${f.details}`).join("\\n\\n") : "No findings — sprint passed all checks."}

## Team Breakdown (Current Sprint)
${Object.entries(hygieneResult.summary.personBreakdown || {}).map(([person, count]) => `- ${person}: ${count} tasks`).join("\\n")}

## Sprint Hygiene Rules Applied
${rulesDoc.substring(0, 2500)}

Generate a COMPLETE HTML email (just the body, no <html>/<head> tags). Be firm and direct. This is an accountability report.
DO NOT wrap in code blocks or markdown. Output ONLY the HTML content directly.`;

  const response = await client.chat.completions.create({
    model: config.openrouter.model,
    messages: [
      { role: "system", content: "You are an expert sprint health analyst and professional email writer. Write clear, actionable reports. Output raw HTML only, no code fences." },
      { role: "user", content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 6000,
  });

  return response.choices[0]?.message?.content || "<p>AI generation failed</p>";
}

// ============================================================
// 4. SEND EMAIL VIA GMAIL (Google Workspace OAuth)
// ============================================================
const { execSync } = require("child_process");
const HELPER_PATH = path.join(__dirname, "gmail_send_helper.py");

async function sendEmail(htmlBody, subject) {
  const recipients = config.email.to.split(",").map(e => e.trim());
  const finalSubject = subject || `🏃 Sprint Health Report — ${config.azureDevOps.project}`;

  console.log(`📧 Sending via Gmail OAuth to: ${recipients.join(", ")}`);
  console.log(`📋 Subject: ${finalSubject}`);

  try {
    // Write HTML body to temp file to avoid shell escaping issues
    const tmpHtmlPath = path.join(__dirname, "..", "output", "_temp_email.html");
    fs.mkdirSync(path.dirname(tmpHtmlPath), { recursive: true });
    fs.writeFileSync(tmpHtmlPath, htmlBody);

    const cmd = `python "${HELPER_PATH}" --body-file "${tmpHtmlPath}" --to "${recipients.join(",")}" --subject "${finalSubject.replace(/"/g, '\\"')}"`;
    const result = execSync(cmd, { encoding: "utf-8", timeout: 60000 });
    console.log(`✅ Gmail send response: ${result.trim()}`);

    // Clean up temp file
    try { fs.unlinkSync(tmpHtmlPath); } catch (e) {}

    return { status: "sent", result: result.trim() };
  } catch (err) {
    console.error(`❌ Email send failed: ${err.message}`);

    // Fallback: save to file
    const outputPath = path.join(__dirname, "..", "output", `sprint-report-${new Date().toISOString().split("T")[0]}.html`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `<!DOCTYPE html><html><body>${htmlBody}</body></html>`);
    console.log(`📄 Fallback: saved to ${outputPath}`);
    return { status: "send_failed_saved_to_file", path: outputPath, error: err.message };
  }
}

// ============================================================
// MAIN ORCHESTRATION
// ============================================================
async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  🏃 Azure DevOps Sprint Health Monitor   ");
  console.log("  AI-Powered Analysis & Email Report      ");
  console.log("═══════════════════════════════════════════\n");

  try {
    // Step 1: Fetch data
    const data = await fetchSprintData();
    console.log(`✅ Fetched ${data.tasks.length} tasks across ${data.sprints.length} sprints`);
    console.log(`   Current sprint: ${data.currentSprint?.name || "Unknown"}`);
    console.log(`   Last sprint: ${data.lastSprint?.name || "Unknown"}\n`);

    // Step 2: Semantic quality analysis (Gemini) - deep task evaluation FIRST
    const semanticAnalysis = await analyzeWorkQuality(data);
    if (semanticAnalysis.error) {
      console.log(`⚠️  Semantic analysis error: ${semanticAnalysis.error}`);
    } else {
      console.log(`✅ Semantic quality complete`);
      console.log(`   Sprint summary: "${(semanticAnalysis.sprintSummary || "").substring(0, 120)}..."`);
      console.log(`   Task quality: ${semanticAnalysis.taskQuality || "unknown"}`);
      console.log(`   Problematic tasks: ${(semanticAnalysis.problematicTasks || []).length}`);
      console.log(`   Unclear work: ${(semanticAnalysis.unclearWork || []).length}`);
      console.log(`   Duplicates/overlaps: ${(semanticAnalysis.duplicateOrOverlapping || []).length}\n`);
    }

    // Step 3: Evaluate hygiene rules (mechanical checks)
    const hygieneResult = evaluateHygiene(data);

    // Step 4: Merge semantic findings into hygiene result
    hygieneResult.semanticAnalysis = semanticAnalysis;

    if (semanticAnalysis && !semanticAnalysis.error) {
      // Add problematic tasks as findings
      (semanticAnalysis.problematicTasks || []).forEach(pt => {
        hygieneResult.findings.push({
          ruleId: "SEMANTIC_QUALITY",
          severity: (pt.severity || "critical").toUpperCase(),
          message: `Task #${pt.id} "${pt.title}" — ${pt.issues[0] || "poorly defined"}`,
          details: pt.issues.join(". "),
        });
      });

      // Add unclear work as findings
      (semanticAnalysis.unclearWork || []).forEach(uw => {
        hygieneResult.findings.push({
          ruleId: "SEMANTIC_UNCLEAR_WORK",
          severity: "WARNING",
          message: `Task #${uw.id} "${uw.title}" — work is unclear`,
          details: uw.problem,
        });
      });

      // Add duplicate/overlapping as findings
      (semanticAnalysis.duplicateOrOverlapping || []).forEach(dup => {
        hygieneResult.findings.push({
          ruleId: "SEMANTIC_DUPLICATE",
          severity: "CRITICAL",
          message: `Potential overlap detected: tasks ${dup.ids.join(", ")}`,
          details: dup.reason,
        });
      });

      // Recalculate grade now that semantic findings are included
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
    const subject = `🏃 Sprint Health Report [Grade: ${hygieneResult.grade}] — ${config.azureDevOps.project} — ${data.currentSprint?.name || "N/A"}`;
    const result = await sendEmail(emailHtml, subject);

    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  Result: ${result.status}`);
    if (result.path) console.log(`  File: ${result.path}`);
    if (result.error) console.log(`  Error: ${result.error}`);
    console.log(`═══════════════════════════════════════════`);

    // Also output summary as JSON for programmatic use
    const summaryPath = path.join(__dirname, "..", "output", `sprint-summary-${new Date().toISOString().split("T")[0]}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      grade: hygieneResult.grade,
      gradeLabel: hygieneResult.gradeLabel,
      semanticAnalysis: semanticAnalysis,
      summary: hygieneResult.summary,
      findings: hygieneResult.findings,
      deliveryStatus: result.status,
    }, null, 2));

    return { data, hygieneResult, emailHtml, result };
  } catch (err) {
    console.error(`\n❌ FATAL ERROR: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
