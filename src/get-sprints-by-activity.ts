import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import dotenv from "dotenv";

dotenv.config();

async function getCurrentAndLastSprint(): Promise<void> {
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL ?? "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT ?? "aidapp";
  const token = process.env.AZURE_DEVOPS_PAT ?? "";

  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);

  try {
    console.log(`Fetching work item tracking API...`);
    const witApi = await webApi.getWorkItemTrackingApi();

    console.log(`Fetching iterations classification node...`);
    const iterationsRoot = await (witApi as any).getClassificationNode(project, "Iterations" as any, false);

    if (!iterationsRoot) {
      console.log("Could not get iterations root node");
      return;
    }

    console.log(`Iterations root:`);
    console.log(`  Name: ${iterationsRoot.name}`);
    console.log(`  Path: ${iterationsRoot.path}`);
    console.log(`  Has children: ${iterationsRoot.hasChildren}`);

    function getAllIterations(node: any, pathSoFar = ""): Array<{ id: number; name: string; path: string }> {
      const iterations: Array<{ id: number; name: string; path: string }> = [];
      const currentPath = pathSoFar ? `${pathSoFar}\\${node.name}` : node.name;

      if (node.structureType === 2) {
        iterations.push({ id: node.id, name: node.name, path: currentPath });
      }

      if (node.hasChildren && node.children) {
        for (const child of node.children) {
          iterations.push(...getAllIterations(child, currentPath));
        }
      }

      return iterations;
    }

    const allIterations = getAllIterations(iterationsRoot);
    console.log(`\nFound ${allIterations.length} iteration nodes in hierarchy:`);
    allIterations.forEach(iter => console.log(`  - ${iter.path}`));

    console.log(`\nFetching work items to determine active sprints by task activity...`);

    const wiql = {
      query: `Select [System.Id], [System.Title], [System.State], [System.IterationPath], [System.ChangedDate] 
              From WorkItems 
              Where [System.WorkItemType] = 'Task' 
                And [System.TeamProject] = '${project}' 
                And [System.State] NOT IN ('Done', 'Removed')`
    };

    const teamContext = { project };
    const wiqlResult = await witApi.queryByWiql(wiql, teamContext);

    if (!wiqlResult.workItems || wiqlResult.workItems.length === 0) {
      console.log("No active tasks found.");
      return;
    }

    console.log(`Found ${wiqlResult.workItems.length} active tasks. Fetching details...`);

    const ids = wiqlResult.workItems.map(item => item.id as number);
    const batchSize = 200;
    const allWorkItems: any[] = [];

    for (let i = 0; i < ids.length; i += batchSize) {
      const batchIds = ids.slice(i, i + batchSize);
      try {
        const batchItems = await witApi.getWorkItems(batchIds);
        if (batchItems) allWorkItems.push(...batchItems);
      } catch (batchErr) {
        console.error(`Error fetching batch starting at index ${i}:`, (batchErr as Error).message);
      }
    }

    console.log(`Retrieved details for ${allWorkItems.length} tasks.`);

    interface IterationActivity {
      count: number;
      latestChangedDate: Date | null;
      sampleTitle: string;
      sampleState: string;
    }

    const iterationActivity = new Map<string, IterationActivity>();

    allWorkItems.forEach(wi => {
      const iterPath: string = ((wi.fields ?? {}))["System.IterationPath"];
      if (!iterPath) return;

      const changedDateStr: string | undefined = ((wi.fields ?? {}))["System.ChangedDate"];
      const changedDate = changedDateStr ? new Date(changedDateStr) : null;

      const current = iterationActivity.get(iterPath) ?? {
        count: 0,
        latestChangedDate: null,
        sampleTitle: ((wi.fields ?? {}))["System.Title"],
        sampleState: ((wi.fields ?? {}))["System.State"],
      };

      current.count++;
      if (changedDate && (!current.latestChangedDate || changedDate > current.latestChangedDate)) {
        current.latestChangedDate = changedDate;
        current.sampleTitle = ((wi.fields ?? {}))["System.Title"];
        current.sampleState = ((wi.fields ?? {}))["System.State"];
      }

      iterationActivity.set(iterPath, current);
    });

    console.log(`\n=== Sprint Activity Analysis (based on task modification dates) ===\n`);
    const sortedActivity = Array.from(iterationActivity.entries())
      .sort((a, b) => {
        const dateA = a[1].latestChangedDate?.getTime() ?? 0;
        const dateB = b[1].latestChangedDate?.getTime() ?? 0;
        return dateB - dateA;
      });

    console.log(`Found ${sortedActivity.length} active iteration paths:`);
    sortedActivity.forEach(([iterPath, info]) => {
      console.log(`Path: ${iterPath}`);
      console.log(`  Task count: ${info.count}`);
      console.log(`  Latest task activity: ${info.latestChangedDate ? info.latestChangedDate.toISOString() : "N/A"}`);
      console.log(`  Sample task: "${info.sampleTitle}" (${info.sampleState})`);
      console.log();
    });

    if (sortedActivity.length > 0) {
      const [currentPath, currentInfo] = sortedActivity[0];
      console.log(`=== CURRENT SPRINT (most recent task activity) ===`);
      console.log(`Path: ${currentPath}`);
      console.log(`Latest task activity: ${currentInfo.latestChangedDate ? currentInfo.latestChangedDate.toISOString() : "N/A"}`);
      console.log(`Task count: ${currentInfo.count}`);
      console.log(`Sample task: "${currentInfo.sampleTitle}" (${currentInfo.sampleState})`);

      if (sortedActivity.length > 1) {
        const [lastPath, lastInfo] = sortedActivity[1];
        console.log(`\n=== LAST SPRINT (second most recent task activity) ===`);
        console.log(`Path: ${lastPath}`);
        console.log(`Latest task activity: ${lastInfo.latestChangedDate ? lastInfo.latestChangedDate.toISOString() : "N/A"}`);
        console.log(`Task count: ${lastInfo.count}`);
        console.log(`Sample task: "${lastInfo.sampleTitle}" (${lastInfo.sampleState})`);
      } else {
        console.log(`\nOnly one active sprint found - no previous sprint with recent activity`);
      }
    } else {
      console.log("No sprint activity found from task data.");
    }

  } catch (err) {
    console.error("Error:", err);
  }
}

getCurrentAndLastSprint().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
