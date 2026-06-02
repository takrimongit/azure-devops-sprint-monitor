import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import dotenv from "dotenv";

dotenv.config();

async function test(): Promise<void> {
  const orgUrl = "https://dev.azure.com/HelpablesOrg";
  const project = "aidapp";
  const token = process.env.AZURE_DEVOPS_PAT ?? "";

  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);
  const witApi = await webApi.getWorkItemTrackingApi();

  try {
    const item = await witApi.getWorkItem(5, undefined, undefined, undefined, undefined, project);
    console.log("getWorkItem(5):", item ? "success" : "failed");
    if (item) {
      console.log("  Title:", item.fields["System.Title"]);
    }
  } catch (e) {
    console.error("getWorkItem error:", e);
  }

  try {
    const items = await witApi.getWorkItems([5], undefined, undefined, undefined, undefined, project);
    console.log("getWorkItems([5]):", items ? `length ${items.length}` : "null");
    if (items?.length > 0) {
      console.log("  Title:", items[0].fields["System.Title"]);
    }
  } catch (e) {
    console.error("getWorkItems error:", e);
  }

  try {
    const items2 = await witApi.getWorkItems([5]);
    console.log("getWorkItems([5]) with only ids:", items2 ? `length ${items2.length}` : "null");
  } catch (e) {
    console.error("getWorkItems (only ids) error:", e);
  }
}

test().catch(console.error);
