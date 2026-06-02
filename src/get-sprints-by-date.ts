import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import dotenv from "dotenv";

dotenv.config();

async function getSprintsByDate(): Promise<void> {
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL ?? "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT ?? "aidapp";
  const token = process.env.AZURE_DEVOPS_PAT ?? "";

  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);

  try {
    console.log(`Fetching work item tracking API...`);
    const witApi = await webApi.getWorkItemTrackingApi();

    console.log(`Fetching core API for team and iteration info...`);
    const coreApi = await webApi.getCoreApi();

    const teams = await coreApi.getTeams(project);
    console.log(`Found ${teams.length} team(s):`);

    if (teams.length === 0) {
      console.log("No teams found. Trying to get iterations directly...");

      try {
        const classificationNode = await witApi.getClassificationNode(project, "Iterations" as any, true);
        console.log("Classification node retrieved:");
        console.log(JSON.stringify(classificationNode, null, 2));
      } catch (classErr) {
        console.log(`Error getting classification node: ${(classErr as Error).message}`);
      }
      return;
    }

    for (const team of teams) {
      console.log(`\n=== Processing team: ${team.name} ===`);

      try {
        const teamIterationsResponse = await (witApi as any).getTeamIterations(project, team.id);
        console.log(`Team iterations response:`, JSON.stringify(teamIterationsResponse, null, 2));

        if (teamIterationsResponse?.value) {
          const iterations: any[] = teamIterationsResponse.value;
          console.log(`Found ${iterations.length} team iterations:`);

          const now = new Date();
          let currentSprint: any = null;
          let lastSprint: any = null;

          iterations.forEach(iteration => {
            console.log(`\nIteration: ${iteration.name}`);
            console.log(`  ID: ${iteration.id}`);
            console.log(`  Path: ${iteration.path}`);

            if (iteration.attributes) {
              console.log(`  Attributes:`);
              if (iteration.attributes.startDate) {
                console.log(`    Start Date: ${new Date(iteration.attributes.startDate).toISOString()}`);
              }
              if (iteration.attributes.finishDate) {
                console.log(`    Finish Date: ${new Date(iteration.attributes.finishDate).toISOString()}`);
              }
              console.log(`    Time Frame: ${iteration.attributes.timeFrame ?? "N/A"}`);

              const startDate = iteration.attributes.startDate ? new Date(iteration.attributes.startDate) : null;
              const finishDate = iteration.attributes.finishDate ? new Date(iteration.attributes.finishDate) : null;

              if (startDate && finishDate) {
                if (now >= startDate && now <= finishDate) {
                  currentSprint = iteration;
                  console.log(`    >>> THIS IS THE CURRENT SPRINT <<<`);
                }
                if (finishDate < now) {
                  if (!lastSprint || finishDate > new Date(lastSprint.attributes.finishDate)) {
                    lastSprint = iteration;
                  }
                }
              }
            }
          });

          console.log(`\n=== RESULTS ===`);
          if (currentSprint) {
            console.log(`Current Sprint:`);
            console.log(`  Name: ${currentSprint.name}`);
            console.log(`  Path: ${currentSprint.path}`);
            console.log(`  Start: ${new Date(currentSprint.attributes.startDate).toISOString()}`);
            console.log(`  Finish: ${new Date(currentSprint.attributes.finishDate).toISOString()}`);
          } else {
            console.log(`No current sprint found (no sprint active today)`);
          }

          if (lastSprint) {
            console.log(`\nLast Completed Sprint:`);
            console.log(`  Name: ${lastSprint.name}`);
            console.log(`  Path: ${lastSprint.path}`);
            console.log(`  Start: ${new Date(lastSprint.attributes.startDate).toISOString()}`);
            console.log(`  Finish: ${new Date(lastSprint.attributes.finishDate).toISOString()}`);
          } else {
            console.log(`\nNo last sprint found`);
          }
        }
      } catch (iterErr) {
        console.log(`Error getting team iterations: ${(iterErr as Error).message}`);

        try {
          console.log(`\nTrying to get iterations via classification nodes...`);
          const iterationsNode = await witApi.getClassificationNode(project, "Iterations" as any, true);

          function extractIterations(node: any, pathPrefix = ""): Array<{ id: number; name: string; path: string }> {
            const iterations: Array<{ id: number; name: string; path: string }> = [];
            const currentPath = pathPrefix ? `${pathPrefix}\\${node.name}` : node.name;

            if (node.structure === 2) {
              iterations.push({ id: node.id, name: node.name, path: currentPath });
            }

            if (node.children) {
              for (const child of node.children) {
                iterations.push(...extractIterations(child, currentPath));
              }
            }

            return iterations;
          }

          const allIterations = extractIterations(iterationsNode);
          console.log(`Found ${allIterations.length} iteration nodes in classification tree:`);
          allIterations.forEach(iter => console.log(`  - ${iter.path} (ID: ${iter.id})`));

        } catch (classErr) {
          console.log(`Error getting classification nodes: ${(classErr as Error).message}`);
        }
      }
    }

  } catch (err) {
    console.error("Error:", err);
  }
}

getSprintsByDate().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
