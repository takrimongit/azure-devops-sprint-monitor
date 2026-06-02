import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import dotenv from "dotenv";

dotenv.config();

async function testGetWorkItems(): Promise<void> {
  const orgUrl = "https://dev.azure.com/HelpablesOrg";
  const project = "aidapp";
  const token = process.env.AZURE_DEVOPS_PAT ?? "";

  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);
  const witApi = await webApi.getWorkItemTrackingApi();

  console.log("Testing getWorkItem for id 5:");
  try {
    const item = await witApi.getWorkItem(5, undefined, undefined, undefined, project as any);
    console.log("  Success:", !!item);
    if (item) {
      console.log("  Fields keys:", Object.keys(item.fields ?? {}).join(", "));
    }
  } catch (e) {
    console.error("  Error:", e);
  }

  console.log("\nTesting getWorkItems with [5] and all undefined except project:");
  try {
    const result = await witApi.getWorkItems([5], undefined, undefined, undefined, project as any);
    console.log("  Result:", result ? `Array length ${result.length}` : "null");
    if (result?.length > 0) {
      console.log("  First item fields keys:", Object.keys(result[0].fields ?? {}).join(", "));
    }
  } catch (e) {
    console.error("  Error:", e);
  }

  console.log("\nTesting getWorkItems with [5] and null errorPolicy:");
  try {
    const result2 = await witApi.getWorkItems([5], undefined, undefined, undefined, null as any, project);
    console.log("  Result with null errorPolicy:", result2 ? `Array length ${result2.length}` : "null");
  } catch (e) {
    console.error("  Error with null errorPolicy:", e);
  }

  console.log("\nTesting getWorkItems without project param:");
  try {
    const result3 = await witApi.getWorkItems([5], undefined, undefined, undefined, undefined);
    console.log("  Result without project:", result3 ? `Array length ${result3.length}` : "null");
  } catch (e) {
    console.error("  Error without project:", e);
  }

  console.log("\nTesting getWorkItems with empty fields array:");
  try {
    const result4 = await witApi.getWorkItems([5], [], undefined, undefined, undefined, project);
    console.log("  Result with empty fields:", result4 ? `Array length ${result4.length}` : "null");
  } catch (e) {
    console.error("  Error with empty fields:", e);
  }

  console.log("\nTesting getWorkItems with fields specified:");
  try {
    const result5 = await witApi.getWorkItems([5], ["System.Title", "System.State"], undefined, undefined, undefined, project);
    console.log("  Result with fields:", result5 ? `Array length ${result5.length}` : "null");
    if (result5?.length > 0) {
      console.log("  First item:", JSON.stringify(result5[0].fields, null, 2));
    }
  } catch (e) {
    console.error("  Error with fields specified:", e);
  }
}

testGetWorkItems().catch(console.error);
