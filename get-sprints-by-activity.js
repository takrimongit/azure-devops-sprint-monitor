const { WebApi, getPersonalAccessTokenHandler } = require("azure-devops-node-api");

async function getCurrentAndLastSprint() {
  // Configuration - you can also use environment variables
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL || "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT || "aidapp";
  // Personal Access Token with at least Work Items (Read) and Wiki (Read) scopes
  const token = process.env.AZURE_DEVOPS_PAT || "REDACTED_PAT";

  // Authentication
  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);
  
  try {
    console.log(`Fetching work item tracking API...`);
    const witApi = await webApi.getWorkItemTrackingApi();
    
    // Get the root classification node for iterations
    console.log(`Fetching iterations classification node...`);
    const iterationsRoot = await witApi.getClassificationNode(project, 'Iterations', false);
    
    if (!iterationsRoot) {
      console.log("Could not get iterations root node");
      return;
    }
    
    console.log(`Iterations root:`);
    console.log(`  Name: ${iterationsRoot.name}`);
    console.log(`  Path: ${iterationsRoot.path}`);
    console.log(`  Has children: ${iterationsRoot.hasChildren}`);
    
    // Function to recursively get all iteration nodes
    function getAllIterations(node, pathSoFar = '') {
      const iterations = [];
      const currentPath = pathSoFar ? `${pathSoFar}\\${node.name}` : node.name;
      
      // Only include nodes that are iterations (structureType 2)
      if (node.structureType === 2) {
        iterations.push({
          id: node.id,
          name: node.name,
          path: currentPath
          // Note: classification nodes from getClassificationNode don't include date attributes
        });
      }
      
      // Recursively process children
      if (node.hasChildren && node.children) {
        for (const child of node.children) {
          iterations.push(...getAllIterations(child, currentPath));
        }
      }
      
      return iterations;
    }
    
    // Get all iteration nodes
    const allIterations = getAllIterations(iterationsRoot);
    console.log(`\\nFound ${allIterations.length} iteration nodes in hierarchy:`);
    allIterations.forEach(iter => {
      console.log(`  - ${iter.path}`);
    });
    
    // Since classification nodes don't have date info, we need to get work items
    // to determine which sprints are active based on task dates
    console.log(`\\nFetching work items to determine active sprints by task activity...`);
    
    // WIQL to get active tasks with iteration paths and changed dates
    const wiql = {
      query: `Select [System.Id], [System.Title], [System.State], [System.IterationPath], [System.ChangedDate] 
              From WorkItems 
              Where [System.WorkItemType] = 'Task' 
                And [System.TeamProject] = '${project}' 
                And [System.State] NOT IN ('Done', 'Removed')`
    };
    
    const teamContext = { project };
    const wiqlResult = await witApi.queryByWiql(wiql, teamContext);
    
    if (!wiqlResult.workItems || wiqlResult.workItems.length === 0) {
      console.log("No active tasks found.");
      return;
    }
    
    console.log(`Found ${wiqlResult.workItems.length} active tasks. Fetching details...`);
    
    // Extract IDs and process in batches to avoid limits
    const ids = wiqlResult.workItems.map(item => item.id);
    const batchSize = 200;
    const allWorkItems = [];
    
    for (let i = 0; i < ids.length; i += batchSize) {
      const batchIds = ids.slice(i, i + batchSize);
      try {
        const batchItems = await witApi.getWorkItems(batchIds);
        if (batchItems) {
          allWorkItems.push(...batchItems);
        }
      } catch (batchErr) {
        console.error(`Error fetching batch starting at index ${i}:`, batchErr.message);
      }
    }
    
    const workItems = allWorkItems;
    console.log(`Retrieved details for ${workItems.length} tasks.`);
    
    // Analyze iteration paths from actual work items (these will have the real paths used)
    const iterationActivity = new Map(); // path => { count, latestChangedDate, sampleTask }
    
    workItems.forEach(wi => {
      const path = wi.fields["System.IterationPath"];
      if (!path) return;
      
      const changedDateStr = wi.fields["System.ChangedDate"];
      const changedDate = changedDateStr ? new Date(changedDateStr) : null;
      
      const current = iterationActivity.get(path) || {
        count: 0,
        latestChangedDate: null,
        sampleTitle: wi.fields["System.Title"],
        sampleState: wi.fields["System.State"]
      };
      
      current.count++;
      if (changedDate && (!current.latestChangedDate || changedDate > current.latestChangedDate)) {
        current.latestChangedDate = changedDate;
        current.sampleTitle = wi.fields["System.Title"];
        current.sampleState = wi.fields["System.State"];
      }
      
      iterationActivity.set(path, current);
    });
    
    console.log(`\\n=== Sprint Activity Analysis (based on task modification dates) ===\\n`);
    // Sort by latestChangedDate descending to find most recently active sprints
    const sortedActivity = Array.from(iterationActivity.entries())
      .sort((a, b) => {
        const dateA = b[1].latestChangedDate ? b[1].latestChangedDate.getTime() : 0;
        const dateB = a[1].latestChangedDate ? a[1].latestChangedDate.getTime() : 0;
        return dateB - dateA; // descending (most recent first)
      });
    
    console.log(`Found ${sortedActivity.length} active iteration paths:`);
    sortedActivity.forEach(([path, info]) => {
      console.log(`Path: ${path}`);
      console.log(`  Task count: ${info.count}`);
      console.log(`  Latest task activity: ${info.latestChangedDate ? info.latestChangedDate.toISOString() : 'N/A'}`);
      console.log(`  Sample task: "${info.sampleTitle}" (${info.sampleState})`);
      console.log();
    });
    
    // Determine current and last sprint based on activity
    if (sortedActivity.length > 0) {
      const [currentPath, currentInfo] = sortedActivity[0];
      console.log(`=== CURRENT SPRINT (most recent task activity) ===`);
      console.log(`Path: ${currentPath}`);
      console.log(`Latest task activity: ${currentInfo.latestChangedDate ? currentInfo.latestChangedDate.toISOString() : 'N/A'}`);
      console.log(`Task count: ${currentInfo.count}`);
      console.log(`Sample task: "${currentInfo.sampleTitle}" (${currentInfo.sampleState})`);
      
      if (sortedActivity.length > 1) {
        const [lastPath, lastInfo] = sortedActivity[1];
        console.log(`\\n=== LAST SPRINT (second most recent task activity) ===`);
        console.log(`Path: ${lastPath}`);
        console.log(`Latest task activity: ${lastInfo.latestChangedDate ? lastInfo.latestChangedDate.toISOString() : 'N/A'}`);
        console.log(`Task count: ${lastInfo.count}`);
        console.log(`Sample task: "${lastInfo.sampleTitle}" (${lastInfo.sampleState})`);
      } else {
        console.log(`\\nOnly one active sprint found - no previous sprint with recent activity`);
      }
    } else {
      console.log("No sprint activity found from task data.");
    }
    
  } catch (err) {
    console.error("Error:", err);
  }
}

getCurrentAndLastSprint().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});