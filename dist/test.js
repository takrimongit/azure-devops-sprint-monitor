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
    const result = await witApi.queryByWiql(wiql, project);
    console.log(JSON.stringify(result, null, 2));
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
