import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import dotenv from "dotenv";

dotenv.config();

async function exploreAPI(): Promise<void> {
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL ?? "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT ?? "aidapp";
  const token = process.env.AZURE_DEVOPS_PAT ?? "";

  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);

  try {
    console.log(`Fetching work item tracking API...`);
    const witApi = await webApi.getWorkItemTrackingApi();

    console.log(`Available methods on witApi:`);
    const methods = Object.keys(witApi).filter(k => typeof (witApi as any)[k] === "function");
    methods.forEach(method => console.log(`  - ${method}`));

    console.log(`\nFetching core API...`);
    const coreApi = await webApi.getCoreApi();

    console.log(`Available methods on coreApi:`);
    const coreMethods = Object.keys(coreApi).filter(k => typeof (coreApi as any)[k] === "function");
    coreMethods.forEach(method => console.log(`  - ${method}`));

    console.log(`\nTrying to get teams via coreApi...`);
    try {
      const teams = await coreApi.getTeams(project);
      console.log(`Found ${teams.length} teams:`);
      teams.forEach(team => console.log(`  - ${team.name} (${team.id})`));
    } catch (teamsErr) {
      console.log(`Error getting teams: ${(teamsErr as Error).message}`);
    }

    console.log(`\nTrying to get classification node with minimal params...`);
    try {
      const result = await witApi.getClassificationNode(project, "Iterations" as any);
      console.log(`getClassificationNode result:`, JSON.stringify(result, null, 2));
    } catch (e) {
      console.log(`getClassificationNode error:`, (e as Error).message);

      try {
        const result2 = await (witApi as any).getClassificationNode(project, "Iterations", false);
        console.log(`getClassificationNode(project, 'Iterations', false):`, JSON.stringify(result2, null, 2));
      } catch (e2) {
        console.log(`getClassificationNode(project, 'Iterations', false) error:`, (e2 as Error).message);
      }
    }

    console.log(`\nGetting work items to see iteration paths...`);
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
      const ids = wiqlResult.workItems.map(item => item.id as number);
      const workItems = await witApi.getWorkItems(ids);

      workItems?.forEach(wi => {
        console.log(`  ID: ${wi.id}`);
        console.log(`    Title: ${(wi.fields ?? {})["System.Title"]}`);
        console.log(`    Iteration Path: ${(wi.fields ?? {})["System.IterationPath"] ?? "Not set"}`);
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
