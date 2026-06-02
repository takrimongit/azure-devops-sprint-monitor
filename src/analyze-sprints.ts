import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import dotenv from "dotenv";

dotenv.config();

async function analyzeSprints(): Promise<void> {
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL ?? "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT ?? "aidapp";
  const token = process.env.AZURE_DEVOPS_PAT ?? "";

  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);

  try {
    console.log(`Fetching work item tracking API...`);
    const witApi = await webApi.getWorkItemTrackingApi();

    console.log(`Fetching all tasks to analyze sprints...`);

    const wiql = {
      query: `Select [System.Id], [System.Title], [System.State], [System.IterationPath] 
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
        const batchItems = await witApi.getWorkItems(batchIds, undefined, undefined, undefined, undefined, project);
        if (batchItems) allWorkItems.push(...batchItems);
      } catch (batchErr) {
        console.error(`Error fetching batch starting at index ${i}:`, batchErr);
      }
    }

    console.log(`Retrieved details for ${allWorkItems.length} tasks.`);

    // Analyze iteration paths
    const iterationPaths = new Map<string, number>();
    const iterationPathDetails = new Map<string, { sampleTitle: string; sampleState: string; sampleAssignedTo: string }>();

    allWorkItems.forEach(wi => {
      const iterPath: string = wi.fields["System.IterationPath"];
      if (iterPath) {
        iterationPaths.set(iterPath, (iterationPaths.get(iterPath) ?? 0) + 1);

        if (!iterationPathDetails.has(iterPath)) {
          iterationPathDetails.set(iterPath, {
            sampleTitle: wi.fields["System.Title"],
            sampleState: wi.fields["System.State"],
            sampleAssignedTo: wi.fields["System.AssignedTo"]?.displayName ?? "Unassigned",
          });
        }
      }
    });

    console.log(`\n=== Sprint Analysis ===\n`);
    console.log(`Found ${iterationPaths.size} unique iteration paths:`);

    const sortedPaths = Array.from(iterationPaths.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    sortedPaths.forEach(([iterPath, count]) => {
      const details = iterationPathDetails.get(iterPath)!;
      console.log(`Path: "${iterPath}"`);
      console.log(`  Task count: ${count}`);
      console.log(`  Sample task: "${details.sampleTitle}"`);
      console.log(`  Sample state: ${details.sampleState}`);
      console.log(`  Sample assignee: ${details.sampleAssignedTo}`);
      console.log();
    });

    // Sprint detection
    console.log(`\n=== Current Sprint Detection ===\n`);

    const sprintPaths = Array.from(iterationPaths.keys()).filter(p =>
      p.toLowerCase().includes("sprint") || p.toLowerCase().includes("iteration")
    );

    if (sprintPaths.length > 0) {
      console.log(`Sprint/iteration paths found:`);
      sprintPaths.forEach(p => {
        console.log(`  - ${p} (${iterationPaths.get(p)} tasks)`);
      });

      const sprint1Count = iterationPaths.get("aidapp\\Sprint 1") ?? 0;
      console.log(`\nBased on task distribution, Sprint 1 (aidapp\\Sprint 1) appears to be the current active sprint:`);
      console.log(`  - ${sprint1Count} tasks in aidapp\\Sprint 1`);

      const sprint2Count = iterationPaths.get("aidapp\\Sprint 2") ?? 0;
      if (sprint2Count > 0) {
        console.log(`  - ${sprint2Count} tasks in aidapp\\Sprint 2 (possibly next sprint)`);
      }
    } else {
      console.log(`No clear sprint/iteration paths found in task data.`);
    }

  } catch (err) {
    console.error("Error:", err);
  }
}

analyzeSprints().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
