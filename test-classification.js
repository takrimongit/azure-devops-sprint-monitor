const { WebApi, getPersonalAccessTokenHandler } = require("azure-devops-node-api");

async function testClassification() {
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
    
    // Try different parameter combinations for getClassificationNode
    console.log(`\\n--- Testing getClassificationNode ---`);
    
    // Try with just project and group
    try {
      const node1 = await witApi.getClassificationNode(project, 'Iterations');
      console.log(`getClassificationNode(project, 'Iterations'):`, 
        node1 ? `Found object with keys: ${Object.keys(node1)}` : 'null');
      if (node1) console.log(JSON.stringify(node1, null, 2));
    } catch (e) {
      console.log(`getClassificationNode(project, 'Iterations') error:`, e.message);
    }
    
    // Try with top=false
    try {
      const node2 = await witApi.getClassificationNode(project, 'Iterations', false);
      console.log(`getClassificationNode(project, 'Iterations', false):`, 
        node2 ? `Found object with keys: ${Object.keys(node2)}` : 'null');
      if (node2) console.log(JSON.stringify(node2, null, 2));
    } catch (e) {
      console.log(`getClassificationNode(project, 'Iterations', false) error:`, e.message);
    }
    
    // Try with top=true
    try {
      const node3 = await witApi.getClassificationNode(project, 'Iterations', true);
      console.log(`getClassificationNode(project, 'Iterations', true):`, 
        node3 ? `Found object with keys: ${Object.keys(node3)}` : 'null');
      if (node3) console.log(JSON.stringify(node3, null, 2));
    } catch (e) {
      console.log(`getClassificationNode(project, 'Iterations', true) error:`, e.message);
    }
    
    // Try with structure parameter
    try {
      // structure: 1=Area, 2=Iteration
      const node4 = await witApi.getClassificationNode(project, 'Iterations', true, 2);
      console.log(`getClassificationNode(project, 'Iterations', true, 2):`, 
        node4 ? `Found object with keys: ${Object.keys(node4)}` : 'null');
      if (node4) console.log(JSON.stringify(node4, null, 2));
    } catch (e) {
      console.log(`getClassificationNode(project, 'Iterations', true, 2) error:`, e.message);
    }
    
    // Try getClassificationNodes (plural)
    try {
      const nodes = await witApi.getClassificationNodes(project, 'Iterations');
      console.log(`getClassificationNodes(project, 'Iterations'):`, 
        nodes ? `Array length: ${nodes.length}` : 'null');
      if (nodes && nodes.length > 0) {
        console.log(`First node:`, JSON.stringify(nodes[0], null, 2));
      }
    } catch (e) {
      console.log(`getClassificationNodes(error):`, e.message);
    }
    
    // Let's also try to get team iterations using the core API and work item tracking API differently
    console.log(`\\n--- Trying to get team via webApi.getTeamApi() ---`);
    try {
      const teamApi = await webApi.getTeamApi();
      console.log(`teamApi available`);
      const teams = await teamApi.getTeams(project);
      console.log(`Found ${teams.length} teams via teamApi`);
      if (teams.length > 0) {
        const team = teams[0];
        console.log(`Team: ${team.name}`);
        // Now try to get team iterations from teamApi
        try {
          const teamIterations = await teamApi.getTeamIterations(project, team.id);
          console.log(`teamApi.getTeamIterations:`, 
            teamIterations ? `Array length: ${teamIterations.length || 'unknown'}` : 'null');
          if (teamIterations && teamIterations.length) {
            console.log(`First team iteration:`, JSON.stringify(teamIterations[0], null, 2));
          }
        } catch (e) {
          console.log(`teamApi.getTeamIterations error:`, e.message);
        }
      }
    } catch (e) {
      console.log(`getTeamApi error:`, e.message);
    }
    
    // Finally, let's get work items and see what iteration paths we have, then maybe we can infer
    // the current sprint by looking for the iteration path with the most recent modified date?
    console.log(`\\n--- Getting work items to analyze iteration paths ---`);
    const wiql = {
      query: `Select Top 50 [System.Id], [System.Title], [System.State], [System.IterationPath], [System.ChangedDate] 
              From WorkItems 
              Where [System.WorkItemType] = 'Task' 
                And [System.TeamProject] = '${project}' 
                And [System.State] NOT IN ('Done', 'Removed')`
    };
    
    const teamContext = { project };
    const wiqlResult = await witApi.queryByWiql(wiql, teamContext);
    
    if (wiqlResult.workItems && wiqlResult.workItems.length > 0) {
      console.log(`Found ${wiqlResult.workItems.length} active tasks. Fetching details...`);
      
      // Get details in batches
      const ids = wiqlResult.workItems.map(item => item.id);
      const batchSize = 200;
      const allWorkItems = [];
      
      for (let i = 0; i < ids.length; i += batchSize) {
        const batchIds = ids.slice(i, i + batchSize);
        try {
          const batchItems = await witApi.getWorkItems(batchIds);
          if (batchItems) allWorkItems.push(...batchItems);
        } catch (batchErr) {
          console.error(`Error fetching batch:`, batchErr);
        }
      }
      
      const workItems = allWorkItems;
      console.log(`Retrieved details for ${workItems.length} tasks.`);
      
      // Group by iteration path and find the most recent changed date
      const iterationInfo = new Map(); // path => { count, latestChangedDate, sampleTask }
      
      workItems.forEach(wi => {
        const path = wi.fields["System.IterationPath"];
        if (!path) return;
        
        const changedDateStr = wi.fields["System.ChangedDate"];
        const changedDate = changedDateStr ? new Date(changedDateStr) : null;
        
        const current = iterationInfo.get(path) || {
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
        
        iterationInfo.set(path, current);
      });
      
      console.log(`\\n=== Iteration Paths from Active Tasks ===\\n`);
      // Sort by latestChangedDate descending
      const sorted = Array.from(iterationInfo.entries())
        .sort((a, b) => {
          const dateA = b[1].latestChangedDate ? b[1].latestChangedDate.getTime() : 0;
          const dateB = a[1].latestChangedDate ? a[1].latestChangedDate.getTime() : 0;
          return dateB - dateA; // descending
        });
      
      sorted.forEach(([path, info]) => {
        console.log(`Path: ${path}`);
        console.log(`  Task count: ${info.count}`);
        console.log(`  Latest changed: ${info.latestChangedDate ? info.latestChangedDate.toISOString() : 'N/A'}`);
        console.log(`  Sample task: "${info.sampleTitle}" (${info.sampleState})`);
        console.log();
      });
      
      // Assume the most recent changed date iteration is current sprint
      if (sorted.length > 0) {
        const [currentPath, currentInfo] = sorted[0];
        console.log(`=== Likely Current Sprint (based on most recent task activity) ===`);
        console.log(`Path: ${currentPath}`);
        console.log(`Latest activity: ${currentInfo.latestChangedDate ? currentInfo.latestChangedDate.toISOString() : 'N/A'}`);
        console.log(`Task count: ${currentInfo.count}`);
        
        // For last sprint, look for the next most recent that is not the same path
        if (sorted.length > 1) {
          const [lastPath, lastInfo] = sorted[1];
          console.log(`\\n=== Likely Last Sprint (second most recent) ===`);
          console.log(`Path: ${lastPath}`);
          console.log(`Latest activity: ${lastInfo.latestChangedDate ? lastInfo.latestChangedDate.toISOString() : 'N/A'}`);
          console.log(`Task count: ${lastInfo.count}`);
        }
      }
    } else {
      console.log("No active tasks found.");
    }
    
  } catch (err) {
    console.error("Error:", err);
  }
}

testClassification().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});