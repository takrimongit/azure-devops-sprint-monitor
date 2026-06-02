const { WebApi, getPersonalAccessTokenHandler } = require("azure-devops-node-api");

async function test() {
  const orgUrl = "https://dev.azure.com/HelpablesOrg";
  const project = "aidapp";
  const token = "REDACTED_PAT";

  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);
  const witApi = await webApi.getWorkItemTrackingApi();

  try {
    // Get one work item we know exists (id 5)
    const item = await witApi.getWorkItem(5, undefined, undefined, undefined, undefined, project);
    console.log("getWorkItem(5):", item ? "success" : "failed");
    if (item) {
      console.log("  Title:", item.fields["System.Title"]);
    }
  } catch (e) {
    console.error("getWorkItem error:", e);
  }

  // Now try getWorkItems with array of one id
  try {
    const items = await witApi.getWorkItems([5], undefined, undefined, undefined, undefined, project);
    console.log("getWorkItems([5]):", items ? `length ${items.length}` : "null");
    if (items && items.length > 0) {
      console.log("  Title:", items[0].fields["System.Title"]);
    }
  } catch (e) {
    console.error("getWorkItems error:", e);
  }

  // Try getWorkItems with only ids parameter (relying on defaults)
  try {
    const items2 = await witApi.getWorkItems([5]);
    console.log("getWorkItems([5]) with only ids:", items2 ? `length ${items2.length}` : "null");
  } catch (e) {
    console.error("getWorkItems (only ids) error:", e);
  }
}

test().catch(console.error);