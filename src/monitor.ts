import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import dotenv from "dotenv";

dotenv.config();

async function main(): Promise<void> {
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL ?? "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT ?? "aidapp";
  const token = process.env.AZURE_DEVOPS_PAT ?? "";

  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);
  const witApi = await webApi.getWorkItemTrackingApi();
  const wikiApi = await webApi.getWikiApi();

  console.log(`Fetching work items (tasks) for project "${project}"...\n`);

  const wiql = {
    query: `Select [System.Id], [System.Title], [System.State], [System.AssignedTo], [System.IterationPath] 
            From WorkItems 
            Where [System.WorkItemType] = 'Task' 
              And [System.TeamProject] = '${project}' 
              And [System.State] NOT IN ('Done', 'Removed')`
  };

  try {
    const teamContext = { project };
    const wiqlResult = await witApi.queryByWiql(wiql, teamContext);

    if (!wiqlResult.workItems || wiqlResult.workItems.length === 0) {
      console.log("No active tasks found.");
      return;
    }

    console.log(`Found ${wiqlResult.workItems.length} task(s) in WIQL result. Fetching details...\n`);

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

    console.log(`=== Active Tasks (${allWorkItems.length}) ===\n`);

    const stateCounts: Record<string, number> = {};
    allWorkItems.forEach(wi => {
      const state: string = wi.fields["System.State"] ?? "Unknown";
      stateCounts[state] = (stateCounts[state] ?? 0) + 1;
    });

    console.log("Summary by state:");
    for (const [state, count] of Object.entries(stateCounts)) {
      console.log(`  ${state}: ${count}`);
    }
    console.log("\n---\n");

    const maxToDisplay = 20;
    allWorkItems.slice(0, maxToDisplay).forEach(wi => {
      const fields = wi.fields;
      console.log(`ID: ${wi.id}`);
      console.log(`  Title: ${fields["System.Title"] ?? "N/A"}`);
      console.log(`  State: ${fields["System.State"] ?? "N/A"}`);
      console.log(`  Assigned To: ${fields["System.AssignedTo"]?.displayName ?? "Unassigned"}`);
      console.log(`  Iteration Path: ${fields["System.IterationPath"] ?? "N/A"}`);
      console.log("");
    });

    if (allWorkItems.length > maxToDisplay) {
      console.log(`... and ${allWorkItems.length - maxToDisplay} more tasks.`);
    }
  } catch (err) {
    console.error("Error fetching work items:", err);
  }

  console.log("\nFetching wiki information...\n");
  try {
    const wikis = await wikiApi.getAllWikis(project);
    if (wikis && wikis.length > 0) {
      console.log(`Found ${wikis.length} wiki(s):\n`);
      for (const wiki of wikis) {
        console.log(`ID: ${wiki.id}`);
        console.log(`  Name: ${wiki.name}`);
        console.log(`  State: ${(wiki as any).state}`);
        console.log(`  Type: ${wiki.type}`);
        console.log(`  URL: ${wiki.url ?? "N/A"}`);
        console.log("");
      }
    } else {
      console.log("No wikis found in the project.");
    }
  } catch (err) {
    console.error("Error fetching wikis:", err);
  }
}

main().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
