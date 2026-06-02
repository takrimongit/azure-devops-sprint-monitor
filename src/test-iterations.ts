import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import dotenv from "dotenv";

dotenv.config();

async function testIterations(): Promise<void> {
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL ?? "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT ?? "aidapp";
  const token = process.env.AZURE_DEVOPS_PAT ?? "";

  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);
  const witApi = await webApi.getWorkItemTrackingApi();

  try {
    console.log(`Fetching team iterations for project "${project}"...`);

    const teamApi = await webApi.getTeamApi();
    const teams = await teamApi.getTeams(project);
    console.log(`Found ${teams.length} team(s):`);
    teams.forEach(team => console.log(`  - ${team.name} (${team.id})`));

    if (teams.length === 0) {
      console.log("No teams found in project");
      return;
    }

    console.log(`Using team: ${teams[0].name}`);

    const iterations = await witApi.getClassificationNode(project, "Iterations" as any, false);

    function printIteration(node: any, indent = 0): void {
      const prefix = "  ".repeat(indent);
      console.log(`${prefix}${node.name} (ID: ${node.id})`);
      console.log(`${prefix}  Path: ${node.path}`);
      console.log(`${prefix}  Structure: ${node.structure}`);
      if (node.children?.length > 0) {
        console.log(`${prefix}  Children:`);
        node.children.forEach((child: any) => printIteration(child, indent + 2));
      }
    }

    console.log(`\nIteration structure:`);
    printIteration(iterations);

    console.log(`\nFetching team iterations for team "${teams[0].name}"...`);
    const teamIterations = await (teamApi as any).getTeamIterations(project, teams[0].id);
    console.log(`Team iterations:`);
    teamIterations.value.forEach((iter: any) => {
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
