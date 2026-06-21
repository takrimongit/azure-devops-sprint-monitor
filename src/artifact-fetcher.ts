import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();
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

interface WorkItemInfo {
  id: number;
  title: string;
  state: string;
  workItemType: string;
  assignedTo: string;
  iterationPath: string;
  url?: string;
}

interface Attachment {
  name: string;
  url: string;
  type: "file" | "hyperlink" | "workitem-link";
  linkType?: string;
  relatedWorkItemId?: number;
  relatedWorkItemTitle?: string;
  relatedWorkItemState?: string;
}

interface CommentEntry {
  author: string;
  text: string;
  createdDate: string;
}

interface TaskWithArtifacts {
  id: number;
  title: string;
  state: string;
  assignedTo: string;
  closedDate: string | null;
  attachments: Attachment[];
  links: Attachment[];
  comments: CommentEntry[];
}

interface UserStoryHierarchy {
  id: number;
  title: string;
  state: string;
  assignedTo: string;
  tasks: TaskWithArtifacts[];
}

interface SprintArtifacts {
  generatedAt: string;
  sprint: string;
  sprintStartDate: string | null;
  sprintEndDate: string | null;
  userStories: UserStoryHierarchy[];
  orphanTasks: TaskWithArtifacts[];
  lastSprint?: SprintArtifacts;
  summary: {
    totalUserStories: number;
    totalTasks: number;
    closedTasks: number;
    totalAttachments: number;
    totalLinks: number;
    totalComments: number;
  };
}

// ============================================================
// CONFIG
// ============================================================

const config = {
  azureDevOps: {
    orgUrl: process.env.AZURE_DEVOPS_ORG_URL ?? "https://dev.azure.com/HelpablesOrg",
    project: process.env.AZURE_DEVOPS_PROJECT ?? "aidapp",
    pat: process.env.AZURE_DEVOPS_PAT ?? "",
  },
};

// ============================================================
// FETCH SPRINT ARTIFACTS
// ============================================================

export async function fetchSprintArtifacts(): Promise<SprintArtifacts | null> {
  const authHandler = getPersonalAccessTokenHandler(config.azureDevOps.pat);
  const webApi = new WebApi(config.azureDevOps.orgUrl, authHandler);
  const witApi = await webApi.getWorkItemTrackingApi();
  const coreApi = await webApi.getCoreApi();
  const workApi = await webApi.getWorkApi();
  const project = config.azureDevOps.project;

  console.log("📡 Fetching sprint artifacts from Azure DevOps...");

  // Step 1: Find current and last sprint
  const teams = await coreApi.getTeams(project);
  const team = teams[0];
  if (!team?.id) {
    console.error("   No team found");
    return null;
  }

  const teamContext = { project, team: team.id };
  const iterations = await workApi.getTeamIterations(teamContext) ?? [];
  const now = new Date();

  let currentIter: any = null;
  let lastIter: any = null;
  for (const iter of iterations) {
    const attrs = (iter as any).attributes;
    const start = attrs?.startDate ? new Date(attrs.startDate) : null;
    const finish = attrs?.finishDate ? new Date(attrs.finishDate) : null;
    if (attrs?.timeFrame === "current" || (start && finish && now >= start && now <= finish)) {
      currentIter = iter;
    }
    if (finish && finish < now) {
      if (!lastIter || finish > new Date((lastIter as any).attributes.finishDate)) {
        lastIter = iter;
      }
    }
  }

  // Between sprints: treat most recent past as current
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

  if (!currentIter) {
    console.error("   No current sprint found");
    return null;
  }

  // Fetch current sprint artifacts
  const currentArtifacts = await fetchArtifactsForSprint(witApi, project, currentIter, now, "Current");
  if (!currentArtifacts) return null;

  // Fetch last sprint artifacts if available
  if (lastIter) {
    const lastArtifacts = await fetchArtifactsForSprint(witApi, project, lastIter, now, "Last");
    if (lastArtifacts) {
      currentArtifacts.lastSprint = lastArtifacts;
    }
  }

  return currentArtifacts;
}

async function fetchArtifactsForSprint(witApi: any, project: string, iteration: any, now: Date, label: string): Promise<SprintArtifacts | null> {
  const sprintPath = iteration.path;
  const sprintName = iteration.name ?? sprintPath;
  const sprintStartDate = iteration.attributes?.startDate
    ? new Date(iteration.attributes.startDate).toISOString().split("T")[0]
    : null;
  const sprintEndDate = iteration.attributes?.finishDate
    ? new Date(iteration.attributes.finishDate).toISOString().split("T")[0]
    : null;

  console.log(`   [${label}] Sprint: ${sprintPath}`);

  // Step 2: Fetch ALL work items in this sprint (User Stories + Tasks)
  const wiql = {
    query: `Select [System.Id], [System.Title], [System.State], [System.WorkItemType],
            [System.AssignedTo], [System.IterationPath], [System.ChangedDate]
            From WorkItems
            Where [System.TeamProject] = '${project}'
              And [System.IterationPath] = '${sprintPath}'
              And ([System.WorkItemType] = 'Task' Or [System.WorkItemType] = 'User Story')`
  };

  const wiqlResult = await witApi.queryByWiql(wiql, { project });
  if (!wiqlResult.workItems || wiqlResult.workItems.length === 0) {
    console.log("   No work items found in sprint");
    return {
      generatedAt: now.toISOString(),
      sprint: sprintName,
      sprintStartDate,
      sprintEndDate,
      userStories: [],
      orphanTasks: [],
      summary: { totalUserStories: 0, totalTasks: 0, closedTasks: 0, totalAttachments: 0, totalLinks: 0, totalComments: 0 },
    };
  }

  // Fetch with relations expanded
  const ids = wiqlResult.workItems.map((item: any) => item.id as number);
  const allWorkItems: any[] = [];
  const batchSize = 200;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = await witApi.getWorkItems(ids.slice(i, i + batchSize), undefined, undefined, 4 /* WorkItemFields.AllRelations */);
    if (batch) allWorkItems.push(...batch);
  }

  console.log(`   Fetched ${allWorkItems.length} work items with relations`);

  // Step 3: Build maps
  const workItemMap = new Map<number, any>();
  for (const wi of allWorkItems) {
    workItemMap.set(wi.id, wi);
  }

  // Step 4: Build parent-child hierarchy
  // User Stories are parents; Tasks are children
  const userStories = new Map<number, UserStoryHierarchy>();
  const orphanTasks: TaskWithArtifacts[] = [];

  // First, identify user stories
  for (const wi of allWorkItems) {
    const f = wi.fields ?? {};
    const type: string = f["System.WorkItemType"] ?? "";
    if (type === "User Story") {
      userStories.set(wi.id, {
        id: wi.id,
        title: f["System.Title"] ?? "",
        state: f["System.State"] ?? "",
        assignedTo: f["System.AssignedTo"]?.displayName ?? "Unassigned",
        tasks: [],
      });
    }
  }

  // Step 5: Process each task — fetch attachments, links, and comments
  for (const wi of allWorkItems) {
    const f = wi.fields ?? {};
    const type: string = f["System.WorkItemType"] ?? "";
    if (type !== "Task") continue;

    const taskId = wi.id;
    const taskTitle: string = f["System.Title"] ?? "";
    const taskState: string = f["System.State"] ?? "";
    const taskAssignedTo: string = f["System.AssignedTo"]?.displayName ?? "Unassigned";
    const closedDate: string | null = f["Microsoft.VSTS.Common.ClosedDate"] ?? null;

    // Parse relations for attachments and links
    const attachments: Attachment[] = [];
    const links: Attachment[] = [];
    const relations = wi.relations ?? [];

    for (const rel of relations) {
      const relType: string = rel.rel ?? "";
      const relUrl: string = rel.url ?? "";
      const relAttributes = rel.attributes ?? {};

      if (relType === "AttachedFile") {
        // File attachment — extract name from attributes or URL
        const fileName = relAttributes?.name ?? path.basename(relUrl) ?? "attachment";
        attachments.push({
          name: fileName,
          url: relUrl,
          type: "file",
        });
      } else if (relType === "Hyperlink") {
        // External hyperlink
        const linkComment = relAttributes?.comment ?? "";
        links.push({
          name: linkComment || relUrl,
          url: relUrl,
          type: "hyperlink",
        });
      } else if (relType.startsWith("System.LinkTypes.Hierarchy")) {
        // Parent/child link — skip, we handle hierarchy via System.Parent
      } else if (relType.startsWith("System.LinkTypes.Related")) {
        // Related work item link
        const relatedId = parseInt(path.basename(relUrl), 10);
        let relatedTitle = "";
        let relatedState = "";
        if (workItemMap.has(relatedId)) {
          relatedTitle = workItemMap.get(relatedId).fields?.["System.Title"] ?? "";
          relatedState = workItemMap.get(relatedId).fields?.["System.State"] ?? "";
        }
        links.push({
          name: `Related: ${relatedTitle || `#${relatedId}`}`,
          url: relUrl,
          type: "workitem-link",
          linkType: "Related",
          relatedWorkItemId: relatedId,
          relatedWorkItemTitle: relatedTitle,
          relatedWorkItemState: relatedState,
        });
      } else if (relType) {
        // Any other link type
        const relatedId = parseInt(path.basename(relUrl), 10);
        let relatedTitle = "";
        let relatedState = "";
        if (!isNaN(relatedId) && workItemMap.has(relatedId)) {
          relatedTitle = workItemMap.get(relatedId).fields?.["System.Title"] ?? "";
          relatedState = workItemMap.get(relatedId).fields?.["System.State"] ?? "";
        }
        links.push({
          name: isNaN(relatedId) ? relUrl : `#${relatedId}: ${relatedTitle}`,
          url: relUrl,
          type: "workitem-link",
          linkType: relType,
          relatedWorkItemId: isNaN(relatedId) ? undefined : relatedId,
          relatedWorkItemTitle: isNaN(relatedId) ? undefined : relatedTitle,
          relatedWorkItemState: isNaN(relatedId) ? undefined : relatedState,
        });
      }
    }

    // Fetch comments
    const comments: CommentEntry[] = [];
    try {
      const commentResult = await (witApi as any).getComments(project, taskId);
      const rawComments = commentResult?.comments ?? [];
      for (const c of rawComments) {
        comments.push({
          author: c?.author?.displayName ?? "Unknown",
          text: c?.text ?? "",
          createdDate: c?.createdDate ? new Date(c.createdDate).toISOString() : "",
        });
      }
    } catch {
      // comments unavailable
    }

    const taskWithArtifacts: TaskWithArtifacts = {
      id: taskId,
      title: taskTitle,
      state: taskState,
      assignedTo: taskAssignedTo,
      closedDate,
      attachments,
      links,
      comments,
    };

    // Find parent user story
    const parentId: number | null = f["System.Parent"] ?? null;
    if (parentId && userStories.has(parentId)) {
      userStories.get(parentId)!.tasks.push(taskWithArtifacts);
    } else {
      // Task without a user story parent in this sprint
      orphanTasks.push(taskWithArtifacts);
    }
  }

  // Step 6: Build summary
  const userStoryList = Array.from(userStories.values());
  const allTasks = [...userStoryList.flatMap(us => us.tasks), ...orphanTasks];
  const closedTasks = allTasks.filter(t => t.state === "Closed" || t.state === "Done");
  const totalAttachments = allTasks.reduce((sum, t) => sum + t.attachments.length, 0);
  const totalLinks = allTasks.reduce((sum, t) => sum + t.links.length, 0);
  const totalComments = allTasks.reduce((sum, t) => sum + t.comments.length, 0);

  const result: SprintArtifacts = {
    generatedAt: now.toISOString(),
    sprint: sprintName,
    sprintStartDate,
    sprintEndDate,
    userStories: userStoryList,
    orphanTasks,
    summary: {
      totalUserStories: userStoryList.length,
      totalTasks: allTasks.length,
      closedTasks: closedTasks.length,
      totalAttachments,
      totalLinks,
      totalComments,
    },
  };

  console.log(`   Artifacts: ${userStoryList.length} user stories, ${allTasks.length} tasks (${closedTasks.length} closed)`);
  console.log(`   ${totalAttachments} attachments, ${totalLinks} links, ${totalComments} comments`);

  return result;
}

// ============================================================
// MAIN — run and save
// ============================================================

async function main() {
  const artifacts = await fetchSprintArtifacts();
  if (!artifacts) {
    console.error("❌ Failed to fetch sprint artifacts");
    process.exit(1);
  }

  const outputDir = path.join(__dirname, "..", "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const dateStr = new Date().toISOString().split("T")[0];
  const outputPath = path.join(outputDir, `sprint-artifacts-${dateStr}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(artifacts, null, 2));
  console.log(`✅ Saved artifacts to ${outputPath}`);
}

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
}
