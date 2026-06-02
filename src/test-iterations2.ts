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

    console.log(`Fetching classification nodes (iterations) for project "${project}"...`);

    const iterationsNode = await witApi.getClassificationNode(project, "Iterations" as any, true);

    function printIteration(node: any, indent = 0): void {
      const prefix = "  ".repeat(indent);
      console.log(`${prefix}${node.name} (ID: ${node.id})`);
      if (node.path) console.log(`${prefix}  Path: ${node.path}`);
      if (node.structure) console.log(`${prefix}  Structure: ${node.structure}`);
      if (node.children?.length > 0) {
        console.log(`${prefix}  Children (${node.children.length}):`);
        node.children.forEach((child: any) => printIteration(child, indent + 2));
      }
    }

    console.log(`\nIteration structure:`);
    printIteration(iterationsNode);

    console.log(`\nTrying to get team settings...`);
    try {
      const teamApi = await webApi.getTeamApi();
      const teams = await teamApi.getTeams(project);
      console.log(`Found ${teams.length} team(s):`);
      teams.forEach(team => console.log(`  - ${team.name} (${team.id})`));
    } catch (teamErr) {
      console.log(`Could not get teams via teamApi: ${(teamErr as Error).message}`);

      try {
        const coreApi = await webApi.getCoreApi();
        const teams = await coreApi.getTeams(project);
        console.log(`Found ${teams.length} team(s) via coreApi:`);
        teams.forEach(team => console.log(`  - ${team.name} (${team.id})`));
      } catch (coreErr) {
        console.log(`Could not get teams via coreApi either: ${(coreErr as Error).message}`);
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
