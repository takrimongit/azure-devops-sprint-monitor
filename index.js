const { WebApi, getPersonalAccessTokenHandler } = require("azure-devops-node-api");

async function main() {
  const orgUrl = "https://dev.azure.com/HelpablesOrg";
  const project = "aidapp";
  const token = "";

  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);
  const witApi = await webApi.getWorkItemTrackingApi();
  const wikiApi = await webApi.getWikiApi();

  console.log("Fetching work items...");
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
    if (wiqlResult.workItems && wiqlResult.workItems.length > 0) {
      const ids = wiqlResult.workItems.map(wi => wi.id);
      const workItems = await witApi.getWorkItems(ids, undefined, undefined, undefined, undefined, project);
      console.log(`\n=== Active Tasks (${workItems.length}) ===\n`);
      workItems.forEach(wi => {
        const fields = wi.fields;
        console.log(`ID: ${wi.id}`);
        console.log(`  Title: ${fields["System.Title"]}`);
        console.log(`  State: ${fields["System.State"]}`);
        console.log(`  Assigned To: ${fields["System.AssignedTo"]?.displayName || "Unassigned"}`);
        console.log(`  Iteration: ${fields["System.IterationPath"] || "N/A"}`);
        console.log("");
      });
    } else {
      console.log("\nNo active tasks found.\n");
    }
  } catch (err) {
    console.error("Error fetching work items:", err);
  }

  console.log("Fetching wikis...");
  try {
    const wikis = await wikiApi.getAllWikis(project);
    if (wikis && wikis.length > 0) {
      console.log(`\n=== Wikis (${wikis.length}) ===\n`);
      for (const wiki of wikis) {
        console.log(`ID: ${wiki.id}`);
        console.log(`  Name: ${wiki.name}`);
        console.log(`  State: ${wiki.state}`);
        console.log(`  Type: ${wiki.type}`);
        console.log("");
      }
    } else {
      console.log("\nNo wikis found.\n");
    }
  } catch (err) {
    console.error("Error fetching wikis:", err);
  }
}

main().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});