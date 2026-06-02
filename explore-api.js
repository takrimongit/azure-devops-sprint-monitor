const { WebApi, getPersonalAccessTokenHandler } = require("azure-devops-node-api");

async function exploreAPI() {
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
    
    console.log(`Available methods on witApi:`);
    const methods = Object.keys(witApi).filter(k => typeof witApi[k] === 'function');
    methods.forEach(method => {
      console.log(`  - ${method}`);
    });
    
    console.log(`\\nFetching work item tracking API...`);
    const coreApi = await webApi.getCoreApi();
    
    console.log(`Available methods on coreApi:`);
    const coreMethods = Object.keys(coreApi).filter(k => typeof coreApi[k] === 'function');
    coreMethods.forEach(method => {
      console.log(`  - ${method}`);
    });
    
    // Try to get teams
    console.log(`\\nTrying to get teams via coreApi...`);
    try {
      const teams = await coreApi.getTeams(project);
      console.log(`Found ${teams.length} teams:`);
      teams.forEach(team => {
        console.log(`  - ${team.name} (${team.id})`);
      });
    } catch (teamsErr) {
      console.log(`Error getting teams: ${teamsErr.message}`);
    }
    
    // Let's look at what we can get from witApi with no parameters first
    console.log(`\\nTrying to get classification node with minimal params...`);
    try {
      // Based on the error we saw, maybe the method expects different parameters
      const result = await witApi.getClassificationNode(project, 'Iterations');
      console.log(`getClassificationNode result:`, JSON.stringify(result, null, 2));
    } catch (e) {
      console.log(`getClassificationNode error:`, e.message);
      
      // Try with just project and 'Iterations'
      try {
        const result = await witApi.getClassificationNode(project, 'Iterations', false);
        console.log(`getClassificationNode(project, 'Iterations', false):`, JSON.stringify(result, null, 2));
      } catch (e2) {
        console.log(`getClassificationNode(project, 'Iterations', false) error:`, e2.message);
      }
    }
    
    // Let's see if we can get work items and extract iteration info from them
    console.log(`\\nGetting work items to see iteration paths...`);
    const wiql = {
      query: `Select Top 10 [System.Id], [System.Title], [System.IterationPath] 
              From WorkItems 
              Where [System.WorkItemType] = 'Task' 
                And [System.TeamProject] = '${project}'`
    };
    
    const teamContext = { project };
    const wiqlResult = await witApi.queryByWiql(wiql, teamContext);
    
    if (wiqlResult.workItems && wiqlResult.workItems.length > 0) {
      console.log(`Found ${wiqlResult.workItems.length} work items:`);
      const ids = wiqlResult.workItems.map(item => item.id);
      const workItems = await witApi.getWorkItems(ids);
      
      workItems.forEach(wi => {
        console.log(`  ID: ${wi.id}`);
        console.log(`    Title: ${wi.fields["System.Title"]}`);
        console.log(`    Iteration Path: ${wi.fields["System.IterationPath"] || "Not set"}`);
        console.log();
      });
    }
    
  } catch (err) {
    console.error("Error:", err);
  }
}

exploreAPI().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});