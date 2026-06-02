"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const azure_devops_node_api_1 = require("azure-devops-node-api");
async function main() {
    const orgUrl = "https://dev.azure.com/HelpablesOrg";
    const project = "aidapp";
    const token = "REDACTED_PAT";
    const authHandler = azure_devops_node_api_1.WebApi.getPersonalAccessTokenHandler(token);
    const webApi = new azure_devops_node_api_1.WebApi(orgUrl, authHandler);
    const witApi = await webApi.getWorkItemTrackingApi();
    const wiql = {
        query: `Select [System.Id], [System.Title], [System.State] From WorkItems Where [System.WorkItemType] = 'Task' And [System.TeamProject] = '${project}'`
    };
    try {
        const result = await witApi.queryByWiql(wiql, undefined);
        console.log("WIQL Result:", JSON.stringify(result, null, 2));
        if (result.workItems && result.workItems.length > 0) {
            const ids = result.workItems.map((wi) => wi.id);
            const workItems = await witApi.getWorkItems(ids, undefined, undefined, undefined, undefined, project);
            console.log("\nWork Items:");
            workItems.forEach((wi) => {
                console.log(`ID: ${wi.id}, Title: ${wi.fields["System.Title"]}, State: ${wi.fields["System.State"]}`);
            });
        }
        else {
            console.log("No work items found.");
        }
    }
    catch (err) {
        console.error("Error:", err);
    }
}
main().catch(err => {
    console.error("Unhandled error:", err);
    process.exit(1);
});
