const { WebApi, getPersonalAccessTokenHandler } = require("azure-devops-node-api");

async function testIterations() {
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
    
    console.log(`Fetching classification nodes (iterations) for project "${project}"...`);
    
    // Get the classification node for iterations
    const iterationsNode = await witApi.getClassificationNode(project, 'Iterations', true);
    
    console.log("Raw iterations node:");
    console.log(JSON.stringify(iterationsNode, null, 2));
    
  } catch (err) {
    console.error("Error:", err);
  }
}

testIterations().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});