import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import dotenv from "dotenv";

dotenv.config();

async function testIterations(): Promise<void> {
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL ?? "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT ?? "aidapp";
  const token = process.env.AZURE_DEVOPS_PAT ?? "";

  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);

  try {
    console.log(`Fetching work item tracking API...`);
    const witApi = await webApi.getWorkItemTrackingApi();

    console.log(`Fetching sample work items to see iteration paths...`);

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

      const ids = wiqlResult.workItems.map(item => item.id as number);
      const workItems = await witApi.getWorkItems(ids);

      workItems?.forEach(wi => {
        console.log(`  ID: ${wi.id}`);
        console.log(`    Title: ${wi.fields["System.Title"]}`);
        console.log(`    Iteration Path: ${wi.fields["System.IterationPath"] ?? "Not set"}`);
        console.log();
      });
    }

    console.log(`\nTrying to get teams...`);
    try {
      const coreApi = await webApi.getCoreApi();
      const teams = await coreApi.getTeams(project);
      console.log(`Found ${teams.length} team(s) via coreApi:`);

      for (const team of teams) {
        console.log(`  Team: ${team.name} (${team.id})`);

        await coreApi.getTeamSettings(project, team.id);
        console.log(`    Team settings retrieved`);

        try {
          const teamIterations = await (witApi as any).getTeamIterations(project, team.id);
          console.log(`    Team iterations (${teamIterations.count}):`);
          teamIterations.value.forEach((iter: any) => {
            console.log(`      - ${iter.name} (ID: ${iter.id})`);
            console.log(`        Path: ${iter.path}`);
            if (iter.attributes) {
              console.log(`        Attributes:`);
              console.log(`          timeFrame: ${iter.attributes.timeFrame ?? "N/A"}`);
              console.log(`          finishDate: ${iter.attributes.finishDate ?? "N/A"}`);
              console.log(`          startDate: ${iter.attributes.startDate ?? "N/A"}`);
            }
          });
        } catch (iterErr) {
          console.log(`    Could not get team iterations: ${(iterErr as Error).message}`);
        }
      }
    } catch (teamErr) {
      console.log(`Error getting teams: ${(teamErr as Error).message}`);

      console.log(`\nTrying to get classification nodes directly...`);
      try {
        const rootNode = await witApi.getClassificationNode(project, "Iterations" as any, false);
        console.log("Root iterations node:");
        console.log(JSON.stringify(rootNode, null, 2));
      } catch (classErr) {
        console.log(`Error getting classification nodes: ${(classErr as Error).message}`);
      }
    }

    console.log(`\nTrying to get all iteration nodes...`);
    try {
      const allIterations = await (witApi as any).getClassificationNodes(project, "Iterations");
      console.log("All iteration nodes:");
      console.log(JSON.stringify(allIterations, null, 2));
    } catch (allIterErr) {
      console.log(`Error getting all iteration nodes: ${(allIterErr as Error).message}`);
    }

  } catch (err) {
    console.error("Error:", err);
  }
}

testIterations().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
