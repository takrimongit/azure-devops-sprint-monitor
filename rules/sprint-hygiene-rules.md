# Sprint Hygiene Best Practices Rules

## Overview
This document defines the sprint hygiene rules used by the Azure DevOps Monitor AI agent to evaluate sprint health, identify issues, and generate actionable reports.

---

## 1. Sprint Planning Rules

### 1.1 Sprint Scope Definition
- **RULE**: All tasks in a sprint must have clear titles and descriptions
- **CHECK**: Tasks with generic titles like "TBD", "TODO", "Fix bugs" are flagged
- **THRESHOLD**: > 10% of tasks with unclear titles = WARNING

### 1.2 Task Estimation
- **RULE**: All tasks should have story points or effort estimates
- **CHECK**: Tasks without estimates are flagged
- **THRESHOLD**: > 20% of tasks without estimates = WARNING

### 1.3 Sprint Commitment
- **RULE**: Sprint should not exceed team capacity
- **CHECK**: Total story points vs historical velocity
- **THRESHOLD**: > 130% of average velocity = WARNING (overcommitment)

---

## 2. Sprint Execution Rules

### 2.1 Work In Progress (WIP) Limits
- **RULE**: Team should not have too many tasks in Active state simultaneously
- **CHECK**: Count of Active tasks per person
- **THRESHOLD**: > 3 Active tasks per person = WARNING
- **THRESHOLD**: > 5 Active tasks per person = CRITICAL

### 2.2 Task Staleness
- **RULE**: Tasks should not remain in the same state for too long
- **CHECK**: Days since last state change for Active/New tasks
- **THRESHOLD**: > 5 days without state change = WARNING
- **THRESHOLD**: > 10 days without state change = CRITICAL

### 2.3 Unassigned Tasks
- **RULE**: All active tasks should have an assignee
- **CHECK**: Tasks in Active/New state without assignee
- **THRESHOLD**: > 5% unassigned active tasks = WARNING

### 2.4 Blocked Tasks
- **RULE**: Blocked tasks should be flagged and escalated
- **CHECK**: Tasks with "Blocked" tag or state
- **THRESHOLD**: Any blocked task older than 1 day = WARNING
- **THRESHOLD**: > 3 blocked tasks = CRITICAL

### 2.5 Task Aging
- **RULE**: Tasks should progress through states in a timely manner
- **CHECK**: Average days in each state
- **THRESHOLD**: Average > 7 days in New state = WARNING
- **THRESHOLD**: Average > 14 days in Active state = WARNING

---

## 3. Sprint Completion Rules

### 3.1 Sprint Goal Progress
- **RULE**: Sprint goal should be on track based on completed story points
- **CHECK**: Completed points / Total committed points at sprint midpoint
- **THRESHOLD**: < 40% completed at midpoint = WARNING
- **THRESHOLD**: < 25% completed at midpoint = CRITICAL

### 3.2 Carry-Over Prevention
- **RULE**: Sprint should not have excessive carry-over from previous sprints
- **CHECK**: Tasks carried over from previous sprint
- **THRESHOLD**: > 20% carry-over = WARNING
- **THRESHOLD**: > 35% carry-over = CRITICAL

### 3.3 Definition of Done
- **RULE**: Completed tasks should meet Definition of Done
- **CHECK**: Closed tasks without proper closure (missing PR links, test results)
- **THRESHOLD**: > 15% of closed tasks without DoD evidence = WARNING

---

## 4. Team Health Indicators

### 4.1 Workload Balance
- **RULE**: Work should be distributed evenly across team members
- **CHECK**: Standard deviation of task counts per person
- **THRESHOLD**: One person with > 3x average = WARNING (overload)
- **THRESHOLD**: One person with < 0.3x average = WARNING (underutilization)

### 4.2 Sprint Velocity Trend
- **RULE**: Velocity should be stable or improving
- **CHECK**: Last 3 sprints velocity trend
- **THRESHOLD**: 3 consecutive declining sprints = WARNING
- **THRESHOLD**: > 30% decline from peak = CRITICAL

### 4.3 Sprint Duration Compliance
- **RULE**: Sprints should follow the planned duration (typically 2 weeks)
- **CHECK**: Actual sprint duration vs planned
- **THRESHOLD**: Sprint running > 1.5x planned duration = WARNING

---

## 5. Risk Indicators

### 5.1 High-Risk Tasks
- **RULE**: Tasks with high complexity or dependencies should be monitored closely
- **CHECK**: Tasks tagged as high-risk or with multiple dependencies
- **THRESHOLD**: Any high-risk task > 3 days without progress = CRITICAL

### 5.2 Technical Debt Accumulation
- **RULE**: Sprint should not add excessive technical debt
- **CHECK**: New "tech debt" or "refactor" tasks added mid-sprint
- **THRESHOLD**: > 5 tech debt tasks added mid-sprint = WARNING

### 5.3 Sprint Scope Creep
- **RULE**: Sprint scope should remain stable after planning
- **CHECK**: Tasks added after sprint start
- **THRESHOLD**: > 15% scope increase = WARNING
- **THRESHOLD**: > 30% scope increase = CRITICAL

---

## Severity Levels

| Level | Description | Action Required |
|-------|-------------|-----------------|
| **INFO** | Informational, no action needed | Monitor |
| **WARNING** | Potential issue, review recommended | Discuss in standup |
| **CRITICAL** | Immediate attention required | Escalate immediately |

---

## Report Categories

The AI-generated email report will be structured into:

1. **Executive Summary** — Overall sprint health score (A-F grade)
2. **Critical Issues** — Items requiring immediate attention
3. **Warnings** — Items to watch and discuss
4. **Progress Status** — What's going well
5. **Recommendations** — AI-suggested actions
6. **Team Metrics** — Velocity, WIP, distribution charts
7. **Next Steps** — Prioritized action items
