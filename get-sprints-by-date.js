const { WebApi, getPersonalAccessTokenHandler } = require("azure-devops-node-api");

async function getSprintsByDate() {
  // Configuration - you can also use environment variables
  const orgUrl = process.env.AZURE_DEVOPS_ORG_URL || "https://dev.azure.com/HelpablesOrg";
  const project = process.env.AZURE_DEVOPS_PROJECT || "aidapp";
  // Personal Access Token with at least Work Items (Read) and Wiki (Read) scopes
  const token = process.env.AZURE_DEVOPS_PAT || "";

  // Authentication
  const authHandler = getPersonalAccessTokenHandler(token);
  const webApi = new WebApi(orgUrl, authHandler);
  
  try {
    console.log(`Fetching work item tracking API...`);
    const witApi = await webApi.getWorkItemTrackingApi();
    
    console.log(`Fetching core API for team and iteration info...`);
    const coreApi = await webApi.getCoreApi();
    
    // Get teams
    const teams = await coreApi.getTeams(project);
    console.log(`Found ${teams.length} team(s):`);
    
    if (teams.length === 0) {
      console.log("No teams found. Trying to get iterations directly...");
      
      // Try to get classification nodes with more details
      try {
        const classificationNode = await witApi.getClassificationNode(project, 'Iterations', true);
        console.log("Classification node retrieved:");
        console.log(JSON.stringify(classificationNode, null, 2));
      } catch (classErr) {
        console.log(`Error getting classification node: ${classErr.message}`);
      }
      return;
    }
    
    // Process each team
    for (const team of teams) {
      console.log(`\\n=== Processing team: ${team.name} ===`);
      
      // Try to get team settings to get default iteration
      try {
        const teamSettings = await coreApi.getTeamSettings(project, team.id);
        console.log(`Team settings: ${JSON.stringify(teamSettings, null, 2)}`);
      } catch (settingsErr) {
        console.log(`Could not get team settings: ${settingsErr.message}`);
      }
      
      // Try to get team iterations - let's see what methods are available
      console.log(`Available methods on witApi:`, Object.keys(witApi).filter(k => typeof witApi[k] === 'function'));
      
      // Let's try the approach from the API docs
      try {
        // Try to get team iterations using the correct method signature
        const teamIterationsResponse = await witApi.getTeamIterations(project, team.id);
        console.log(`Team iterations response:`, JSON.stringify(teamIterationsResponse, null, 2));
        
        if (teamIterationsResponse && teamIterationsResponse.value) {
          const iterations = teamIterationsResponse.value;
          console.log(`Found ${iterations.length} team iterations:`);
          
          const now = new Date();
          let currentSprint = null;
          let lastSprint = null;
          
          // Process iterations to find current and last based on dates
          iterations.forEach(iteration => {
            console.log(`\\nIteration: ${iteration.name}`);
            console.log(`  ID: ${iteration.id}`);
            console.log(`  Path: ${iteration.path}`);
            
            if (iteration.attributes) {
              console.log(`  Attributes:`);
              if (iteration.attributes.startDate) {
                const startDate = new Date(iteration.attributes.startDate);
                console.log(`    Start Date: ${startDate.toISOString()}`);
              }
              if (iteration.attributes.finishDate) {
                const finishDate = new Date(iteration.attributes.finishDate);
                console.log(`    Finish Date: ${finishDate.toISOString()}`);
              }
              console.log(`    Time Frame: ${iteration.attributes.timeFrame || 'N/A'}`);
            }
            
            // Check if this is the current sprint
            if (iteration.attributes) {
              const startDate = iteration.attributes.startDate ? new Date(iteration.attributes.startDate) : null;
              const finishDate = iteration.attributes.finishDate ? new Date(iteration.attributes.finishDate) : null;
              
              if (startDate && finishDate) {
                if (now >= startDate && now <= finishDate) {
                  currentSprint = iteration;
                  console.log(`    >>> THIS IS THE CURRENT SPRINT <<<`);
                }
                
                // Track the most recent completed sprint
                if (finishDate < now) {
                  if (!lastSprint || finishDate > new Date(lastSprint.attributes.finishDate)) {
                    lastSprint = iteration;
                  }
                }
              }
            }
          });
          
          console.log(`\\n=== RESULTS ===`);
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
            console.log(`\\nLast Completed Sprint:`);
            console.log(`  Name: ${lastSprint.name}`);
            console.log(`  Path: ${lastSprint.path}`);
            console.log(`  Start: ${new Date(lastSprint.attributes.startDate).toISOString()}`);
            console.log(`  Finish: ${new Date(lastSprint.attributes.finishDate).toISOString()}`);
          } else {
            console.log(`\\nNo last sprint found`);
          }
        }
      } catch (iterErr) {
        console.log(`Error getting team iterations: ${iterErr.message}`);
        console.log(`This might be because the method doesn't exist or requires different parameters`);
        
        // Let's try to get iterations through classification nodes instead
        try {
          console.log(`\\nTrying to get iterations via classification nodes...`);
          const iterationsNode = await witApi.getClassificationNode(project, 'Iterations', true);
          
          // Function to extract iteration info from classification tree
          function extractIterations(node, pathPrefix = '') {
            const iterations = [];
            const currentPath = pathPrefix ? `${pathPrefix}\\${node.name}` : node.name;
            
            if (node.structure === 2) { // 2 = Iteration (1 = Area, 2 = Iteration)
              iterations.push({
                id: node.id,
                name: node.name,
                path: currentPath
                // Note: classification nodes might not have date attributes
              });
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
          allIterations.forEach(iter => {
            console.log(`  - ${iter.path} (ID: ${iter.id})`);
          });
          
        } catch (classErr) {
          console.log(`Error getting classification nodes: ${classErr.message}`);
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