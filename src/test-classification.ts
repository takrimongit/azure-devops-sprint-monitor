import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import dotenv from "dotenv";

dotenv.config();

async function testClassification(): Promise<void> {
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL ?? "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT ?? "aidapp";
  const token = process.env.AZURE_DEVOPS_PAT ?? "";

  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);

  try {
    console.log(`Fetching work item tracking API...`);
    const witApi = await webApi.getWorkItemTrackingApi();

    console.log(`\n--- Testing getClassificationNode ---`);

    try {
      const node1 = await (witApi as any).getClassificationNode(project, "Iterations" as any);
      console.log(`getClassificationNode(project, 'Iterations'):`, node1 ? `Found object with keys: ${Object.keys(node1)}` : "null");
      if (node1) console.log(JSON.stringify(node1, null, 2));
    } catch (e) {
      console.log(`getClassificationNode(project, 'Iterations') error:`, (e as Error).message);
    }

    try {
      const node2 = await (witApi as any).getClassificationNode(project, "Iterations" as any, false);
      console.log(`getClassificationNode(project, 'Iterations', false):`, node2 ? `Found object with keys: ${Object.keys(node2)}` : "null");
      if (node2) console.log(JSON.stringify(node2, null, 2));
    } catch (e) {
      console.log(`getClassificationNode(project, 'Iterations', false) error:`, (e as Error).message);
    }

    try {
      const node3 = await (witApi as any).getClassificationNode(project, "Iterations" as any, true);
      console.log(`getClassificationNode(project, 'Iterations', true):`, node3 ? `Found object with keys: ${Object.keys(node3)}` : "null");
      if (node3) console.log(JSON.stringify(node3, null, 2));
    } catch (e) {
      console.log(`getClassificationNode(project, 'Iterations', true) error:`, (e as Error).message);
    }

    try {
      const node4 = await (witApi as any).getClassificationNode(project, "Iterations" as any, true, 2);
      console.log(`getClassificationNode(project, 'Iterations', true, 2):`, node4 ? `Found object with keys: ${Object.keys(node4)}` : "null");
      if (node4) console.log(JSON.stringify(node4, null, 2));
    } catch (e) {
      console.log(`getClassificationNode(project, 'Iterations', true, 2) error:`, (e as Error).message);
    }

    try {
      const nodes = await (witApi as any).getClassificationNodes(project, "Iterations");
      console.log(`getClassificationNodes(project, 'Iterations'):`, nodes ? `Array length: ${nodes.length}` : "null");
      if (nodes?.length > 0) console.log(`First node:`, JSON.stringify(nodes[0], null, 2));
    } catch (e) {
      console.log(`getClassificationNodes error:`, (e as Error).message);
    }

    console.log(`\n--- Trying to get team via webApi.getTeamApi() ---`);
    try {
      const teamApi = await (webApi as any).getTeamApi();
      console.log(`teamApi available`);
      const teams = await teamApi.getTeams(project);
      console.log(`Found ${teams.length} teams via teamApi`);
      if (teams.length > 0) {
        const team = teams[0];
        console.log(`Team: ${team.name}`);
        try {
          const teamIterations = await (teamApi as any).getTeamIterations(project, team.id);
          console.log(`teamApi.getTeamIterations:`, teamIterations ? `Array length: ${teamIterations.length ?? "unknown"}` : "null");
          if (teamIterations?.length) console.log(`First team iteration:`, JSON.stringify(teamIterations[0], null, 2));
        } catch (e) {
          console.log(`teamApi.getTeamIterations error:`, (e as Error).message);
        }
      }
    } catch (e) {
      console.log(`getTeamApi error:`, (e as Error).message);
    }

    console.log(`\n--- Getting work items to analyze iteration paths ---`);
    const wiql = {
      query: `Select Top 50 [System.Id], [System.Title], [System.State], [System.IterationPath], [System.ChangedDate] 
              From WorkItems 
              Where [System.WorkItemType] = 'Task' 
                And [System.TeamProject] = '${project}' 
                And [System.State] NOT IN ('Done', 'Removed')`
    };

    const teamContext = { project };
    const wiqlResult = await witApi.queryByWiql(wiql, teamContext);

    if (wiqlResult.workItems && wiqlResult.workItems.length > 0) {
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
          console.error(`Error fetching batch:`, batchErr);
        }
      }

      console.log(`Retrieved details for ${allWorkItems.length} tasks.`);

      interface IterInfo {
        count: number;
        latestChangedDate: Date | null;
        sampleTitle: string;
        sampleState: string;
      }

      const iterationInfo = new Map<string, IterInfo>();

      allWorkItems.forEach(wi => {
        const iterPath: string = ((wi.fields ?? {}))["System.IterationPath"];
        if (!iterPath) return;

        const changedDateStr: string | undefined = ((wi.fields ?? {}))["System.ChangedDate"];
        const changedDate = changedDateStr ? new Date(changedDateStr) : null;

        const current = iterationInfo.get(iterPath) ?? {
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

        iterationInfo.set(iterPath, current);
      });

      console.log(`\n=== Iteration Paths from Active Tasks ===\n`);
      const sorted = Array.from(iterationInfo.entries())
        .sort((a, b) => (b[1].latestChangedDate?.getTime() ?? 0) - (a[1].latestChangedDate?.getTime() ?? 0));

      sorted.forEach(([iterPath, info]) => {
        console.log(`Path: ${iterPath}`);
        console.log(`  Task count: ${info.count}`);
        console.log(`  Latest changed: ${info.latestChangedDate ? info.latestChangedDate.toISOString() : "N/A"}`);
        console.log(`  Sample task: "${info.sampleTitle}" (${info.sampleState})`);
        console.log();
      });

      if (sorted.length > 0) {
        const [currentPath, currentInfo] = sorted[0];
        console.log(`=== Likely Current Sprint (based on most recent task activity) ===`);
        console.log(`Path: ${currentPath}`);
        console.log(`Latest activity: ${currentInfo.latestChangedDate ? currentInfo.latestChangedDate.toISOString() : "N/A"}`);
        console.log(`Task count: ${currentInfo.count}`);

        if (sorted.length > 1) {
          const [lastPath, lastInfo] = sorted[1];
          console.log(`\n=== Likely Last Sprint (second most recent) ===`);
          console.log(`Path: ${lastPath}`);
          console.log(`Latest activity: ${lastInfo.latestChangedDate ? lastInfo.latestChangedDate.toISOString() : "N/A"}`);
          console.log(`Task count: ${lastInfo.count}`);
        }
      }
    } else {
      console.log("No active tasks found.");
    }

  } catch (err) {
    console.error("Error:", err);
  }
}

testClassification().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
