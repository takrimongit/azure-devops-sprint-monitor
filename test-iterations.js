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
  const witApi = await webApi.getWorkItemTrackingApi();

  try {
    console.log(`Fetching team iterations for project "${project}"...`);
    
    // Get team settings first to get the default team
    const teamApi = await webApi.getTeamApi();
    const teams = await teamApi.getTeams(project);
    console.log(`Found ${teams.length} team(s):`);
    teams.forEach(team => {
      console.log(`  - ${team.name} (${team.id})`);
    });
    
    if (teams.length === 0) {
      console.log("No teams found in project");
      return;
    }
    
    // Use the first team (you might want to make this configurable)
    const teamId = teams[0].id;
    console.log(`Using team: ${teams[0].name}`);
    
    // Get team iterations (classification nodes for iterations)
    const iterations = await witApi.getClassificationNode(project, 'Iterations', false);
    
    function printIteration(node, indent = 0) {
      const prefix = '  '.repeat(indent);
      console.log(`${prefix}${node.name} (ID: ${node.id})`);
      console.log(`${prefix}  Path: ${node.path}`);
      console.log(`${prefix}  Structure: ${node.structure}`);
      if (node.children && node.children.length > 0) {
        console.log(`${prefix}  Children:`);
        node.children.forEach(child => printIteration(child, indent + 2));
      }
    }
    
    console.log(`\\nIteration structure:`);
    printIteration(iterations);
    
    // Also get team-specific iterations
    console.log(`\\nFetching team iterations for team "${teams[0].name}"...`);
    const teamIterations = await teamApi.getTeamIterations(project, teams[0].id);
    console.log(`Team iterations:`);
    teamIterations.value.forEach(iter => {
      console.log(`  - ${iter.name} (ID: ${iter.id})`);
      console.log(`    Path: ${iter.path}`);
      console.log(`    Attributes:`, iter.attributes);
    });
    
  } catch (err) {
    console.error("Error fetching iterations:", err);
  }
}

testIterations().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});