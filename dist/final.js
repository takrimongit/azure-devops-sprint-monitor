"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const azure_devops_node_api_1 = require("azure-devops-node-api");
async function main() {
    const orgUrl = "https://dev.azure.com/HelpablesOrg";
    const project = "aidapp";
    const token = "REDACTED_PAT";
    const authHandler = (0, azure_devops_node_api_1.getPersonalAccessTokenHandler)(token);
    const webApi = new azure_devops_node_api_1.WebApi(orgUrl, authHandler);
    const witApi = await webApi.getWorkItemTrackingApi();
    const wikiApi = await webApi.getWikiApi();
    console.log("Fetching work items...");
    const wiql = {
        query: `Select [System.Id], [System.Title], [System.State], [System.AssignedTo], [System.IterationPath] 
            From WorkItems 
            Where [System.WorkItemType] = 'Task' 
              And [System.TeamProject] = '${project}' 
              And [System.State] NOT IN ('Done', 'Removed')`
    };
    try {
        const wiqlResult = await witApi.queryByWiql(wiql, undefined);
        if (wiqlResult.workItems && wiqlResult.workItems.length > 0) {
            const ids = wiqlResult.workItems.map((wi) => wi.id);
            const workItems = await witApi.getWorkItems(ids, undefined, undefined, undefined, undefined, project);
            console.log(`\n=== Active Tasks (${workItems.length}) ===\");
      workItems.forEach((wi: any) => {
        const fields = wi.fields;
        console.log(`, ID, $, { wi, : .id } `);
        console.log(`, Title, $, { fields, ["System.Title"]:  } `);
        console.log(`, State, $, { fields, ["System.State"]:  } `);
        console.log(`, Assigned, To, $, { fields, ["System.AssignedTo"]: ?.displayName || "Unassigned" } `);
        console.log(`, Iteration, $, { fields, ["System.IterationPath"]:  || "N/A" } `);
        console.log("");
      });
    } else {
      console.log("\nNo active tasks found.");
    }
  } catch (err) {
    console.error("Error fetching work items:", err);
  }

  console.log("Fetching wiki pages...");
  try {
    const wikis = await wikiApi.getWikis(project);
    if (wikis.count > 0) {
      const wikiId = wikis.value[0].id;
      console.log(`, n === Wiki, Pages($, { wikis, : .value[0].name }) === , "););
            const pages = await wikiApi.getPages(wikiId, undefined, undefined, undefined, project);
            if (pages && pages.length > 0) {
                for (const page of pages) {
                    console.log(`Path: ${page.path}`);
                    console.log(`  Last Modified: ${new Date(page.lastModifiedDate).toLocaleString()}`);
                    console.log(`  Content URL: ${page.url}`);
                    console.log("");
                }
            }
            else {
                console.log("No wiki pages found.");
            }
        }
        else {
            console.log("\nNo wiki found for this project.");
        }
    }
    catch (err) {
        console.error("Error fetching wiki:", err);
    }
}
main().catch(err => {
    console.error("Unhandled error:", err);
    process.exit(1);
});
