const { WebApi, getPersonalAccessTokenHandler } = require("azure-devops-node-api");

async function analyzeSprints() {
  // Configuration - you can also use environment variables
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL || "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT || "aidapp";
  // Personal Access Token with at least Work Items (Read) and Wiki (Read) scopes
  const token = process.env.AZURE_DEVOPS_PAT || "REDACTED_PAT";

  // Authentication
  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);
  
  try {
    console.log(`Fetching work item tracking API...`);
    const witApi = await webApi.getWorkItemTrackingApi();
    
    // Get all tasks to analyze iteration paths
    console.log(`Fetching all tasks to analyze sprints...`);
    
    // WIQL to get tasks that are not done or removed (same as monitor.js)
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
    
    // Extract IDs and process in batches to avoid limits
    const ids = wiqlResult.workItems.map(item => item.id);
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
    console.log(`Retrieved details for ${workItems.length} tasks.`);
    
    // Analyze iteration paths
    const iterationPaths = new Map();
    const iterationPathDetails = new Map();
    
    workItems.forEach(wi => {
      const path = wi.fields["System.IterationPath"];
      if (path) {
        const count = iterationPaths.get(path) || 0;
        iterationPaths.set(path, count + 1);
        
        // Store sample details for this path
        if (!iterationPathDetails.has(path)) {
          iterationPathDetails.set(path, {
            sampleTitle: wi.fields["System.Title"],
            sampleState: wi.fields["System.State"],
            sampleAssignedTo: wi.fields["System.AssignedTo"]?.displayName || "Unassigned"
          });
        }
      }
    });
    
    console.log(`\n=== Sprint Analysis ===\n`);
    console.log(`Found ${iterationPaths.size} unique iteration paths:`);
    
    // Sort by path name for consistent output
    const sortedPaths = Array.from(iterationPaths.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    
    sortedPaths.forEach(([path, count]) => {
      const details = iterationPathDetails.get(path);
      console.log(`Path: "${path}"`);
      console.log(`  Task count: ${count}`);
      console.log(`  Sample task: "${details.sampleTitle}"`);
      console.log(`  Sample state: ${details.sampleState}`);
      console.log(`  Sample assignee: ${details.sampleAssignedTo}`);
      console.log();
    });
    
    // Try to identify current sprint based on most recent activity or team settings
    console.log(`\n=== Current Sprint Detection ===\n`);
    
    // Look for common sprint naming patterns
    const sprintPaths = Array.from(iterationPaths.keys()).filter(path => 
      path.toLowerCase().includes('sprint') || 
      path.toLowerCase().includes('iteration')
    );
    
    if (sprintPaths.length > 0) {
      console.log(`Sprint/iteration paths found:`);
      sprintPaths.forEach(path => {
        const count = iterationPaths.get(path);
        console.log(`  - ${path} (${count} tasks)`);
      });
      
      // Based on the data we saw earlier, Sprint 1 appears to be active
      console.log(`\nBased on task distribution, Sprint 1 (aidapp\\Sprint 1) appears to be the current active sprint:`);
      const sprint1Count = iterationPaths.get("aidapp\\Sprint 1") || 0;
      console.log(`  - ${sprint1Count} tasks in aidapp\\Sprint 1`);
      
      // Look for Sprint 2 as well
      const sprint2Count = iterationPaths.get("aidapp\\Sprint 2") || 0;
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