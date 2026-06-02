const { WebApi, getPersonalAccessTokenHandler } = require("azure-devops-node-api");

async function testIterations() {
  // Configuration - you can also use environment variables
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL || "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT || "aidapp";
  // Personal Access Token with at least Work Items (Read) and Wiki (Read) scopes
  const token = process.env.AZURE_DEVOPS_PAT || "";

  // Authentication
  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);
  
  try {
    console.log(`Fetching work item tracking API...`);
    const witApi = await webApi.getWorkItemTrackingApi();
    
    // Let's look at some work items to see what iteration paths they have
    console.log(`Fetching sample work items to see iteration paths...`);
    
    // WIQL to get a few tasks
    const wiql = {
      query: `Select Top 5 [System.Id], [System.Title], [System.IterationPath] 
              From WorkItems 
              Where [System.WorkItemType] = 'Task' 
                And [System.TeamProject] = '${project}'`
    };
    
    const teamContext = { project };
    const wiqlResult = await witApi.queryByWiql(wiql, teamContext);
    
    if (wiqlResult.workItems && wiqlResult.workItems.length > 0) {
      console.log(`Found ${wiqlResult.workItems.length} sample work items:`);
      
      const ids = wiqlResult.workItems.map(item => item.id);
      const workItems = await witApi.getWorkItems(ids);
      
      workItems.forEach(wi => {
        console.log(`  ID: ${wi.id}`);
        console.log(`    Title: ${wi.fields["System.Title"]}`);
        console.log(`    Iteration Path: ${wi.fields["System.IterationPath"] || "Not set"}`);
        console.log();
      });
    }
    
    // Now let's try to get teams and team iterations properly
    console.log(`\\nTrying to get teams...`);
    try {
      // Try to get the core API for teams
      const coreApi = await webApi.getCoreApi();
      const teams = await coreApi.getTeams(project);
      console.log(`Found ${teams.length} team(s) via coreApi:`);
      
      for (const team of teams) {
        console.log(`  Team: ${team.name} (${team.id})`);
        
        // Get team settings
        const teamSettings = await coreApi.getTeamSettings(project, team.id);
        console.log(`    Team settings retrieved`);
        
        // Try to get team iterations via work item tracking API
        try {
          const teamIterations = await witApi.getTeamIterations(project, team.id);
          console.log(`    Team iterations (${teamIterations.count}):`);
          teamIterations.value.forEach(iter => {
            console.log(`      - ${iter.name} (ID: ${iter.id})`);
            console.log(`        Path: ${iter.path}`);
            if (iter.attributes) {
              console.log(`        Attributes:`);
              console.log(`          timeFrame: ${iter.attributes.timeFrame || 'N/A'}`);
              console.log(`          finishDate: ${iter.attributes.finishDate || 'N/A'}`);
              console.log(`          startDate: ${iter.attributes.startDate || 'N/A'}`);
            }
          });
        } catch (iterErr) {
          console.log(`    Could not get team iterations: ${iterErr.message}`);
        }
      }
    } catch (teamErr) {
      console.log(`Error getting teams: ${teamErr.message}`);
      
      // Try alternative: get classification nodes directly
      console.log(`\\nTrying to get classification nodes directly...`);
      try {
        // Get top-level classification nodes
        const rootNode = await witApi.getClassificationNode(project, 'Iterations', false);
        console.log("Root iterations node:");
        console.log(JSON.stringify(rootNode, null, 2));
      } catch (classErr) {
        console.log(`Error getting classification nodes: ${classErr.message}`);
      }
    }
    
  } catch (err) {
    console.error("Error:", err);
  }
}

testIterations().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});