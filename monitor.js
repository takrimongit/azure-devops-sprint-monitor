const { WebApi, getPersonalAccessTokenHandler } = require("azure-devops-node-api");

async function main() {
  // Configuration - you can also use environment variables
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL || "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT || "aidapp";
  // Personal Access Token with at least Work Items (Read) and Wiki (Read) scopes
  const token = process.env.AZURE_DEVOPS_PAT || "";

  // Authentication
  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);
  const witApi = await webApi.getWorkItemTrackingApi();
  const wikiApi = await webApi.getWikiApi();

  console.log(`Fetching work items (tasks) for project "${project}"...\n`);

  // WIQL to get tasks that are not done or removed
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
    
    // Extract IDs
    const ids = wiqlResult.workItems.map(item => item.id);
    
    // Process in batches of 200 to avoid any potential limits
    const batchSize = 200;
    const allWorkItems = [];
    
    for (let i = 0; i < ids.length; i += batchSize) {
      const batchIds = ids.slice(i, i + batchSize);
      try {
        const batchItems = await witApi.getWorkItems(batchIds, undefined, undefined, undefined, undefined, project);
        if (batchItems) {
          allWorkItems.push(...batchItems);
        }
      } catch (batchErr) {
        console.error(`Error fetching batch starting at index ${i}:`, batchErr);
      }
    }
    
    const workItems = allWorkItems;
    
    console.log(`=== Active Tasks (${workItems.length}) ===\n`);
    
    // Group by state for summary
    const stateCounts = {};
    workItems.forEach(wi => {
      const state = wi.fields["System.State"] || "Unknown";
      stateCounts[state] = (stateCounts[state] || 0) + 1;
    });
    
    console.log("Summary by state:");
    for (const [state, count] of Object.entries(stateCounts)) {
      console.log(`  ${state}: ${count}`);
    }
    console.log("\n---\n");
    
    // List each task (limit to first 20 for brevity in console, but we'll log all to file if needed)
    const maxToDisplay = 20;
    const displayItems = workItems.slice(0, maxToDisplay);
    displayItems.forEach(wi => {
      const fields = wi.fields;
      console.log(`ID: ${wi.id}`);
      console.log(`  Title: ${fields["System.Title"] || "N/A"}`);
      console.log(`  State: ${fields["System.State"] || "N/A"}`);
      console.log(`  Assigned To: ${fields["System.AssignedTo"]?.displayName || "Unassigned"}`);
      console.log(`  Iteration Path: ${fields["System.IterationPath"] || "N/A"}`);
      console.log("");
    });
    if (workItems.length > maxToDisplay) {
      console.log(`... and ${workItems.length - maxToDisplay} more tasks.`);
    }
  } catch (err) {
    console.error("Error fetching work items:", err);
  }

  console.log("\nFetching wiki information...\n");
  try {
    // Try to get all wikis in the project
    const wikis = await wikiApi.getAllWikis(project);
    if (wikis && wikis.length > 0) {
      console.log(`Found ${wikis.length} wiki(s):\n`);
      for (const wiki of wikis) {
        console.log(`ID: ${wiki.id}`);
        console.log(`  Name: ${wiki.name}`);
        console.log(`  State: ${wiki.state}`);
        console.log(`  Type: ${wiki.type}`);
        console.log(`  URL: ${wiki.url || "N/A"}`);
        console.log("");
        
        // Optionally fetch pages for the first wiki
        if (wiki.id) {
          try {
            const pages = await wikiApi.getPages(wiki.id, undefined, undefined, undefined, project);
            if (pages && pages.length > 0) {
              console.log(`    Pages in wiki "${wiki.name}" (${pages.length}):`);
              for (const page of pages) {
                console.log(`      - Path: ${page.path || "N/A"}`);
              }
            } else {
              console.log(`    No pages found in wiki "${wiki.name}".`);
            }
          } catch (pageErr) {
            console.error(`    Error fetching pages for wiki ${wiki.id}:`, pageErr);
          }
        }
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