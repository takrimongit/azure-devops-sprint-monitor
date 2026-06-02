# Azure DevOps Team Progress Monitor

This project monitors your Azure DevOps instance for:
1. Sprint task completion (active tasks by state)
2. Wiki updates (meeting notes, action items, etc.)

## Files Created
- `src/index.ts` - Main TypeScript monitoring script
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `monitor.js` - Compiled JavaScript version (for immediate use)

## Current Status
✅ Successfully connected to Azure DevOps Organization: `HelpablesOrg`
✅ Project: `aidapp`
✅ Found 704 tasks with breakdown:
   - Closed: 620
   - New: 69
   - Active: 15

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Authentication
The script uses a Personal Access Token (PAT) with read access to Work Items and Wiki.
You can:
- Keep the hardcoded token (for testing only)
- Set environment variables:
  ```bash
  export AZURE_DEVOPS_ORG_URL="https://dev.azure.com/HelpablesOrg"
  export AZURE_DEVOPS_PROJECT="aidapp"
  export AZURE_DEVOPS_PAT="your_pat_here"
  ```

### 3. Run the Monitor
```bash
# For one-time execution
npm run dev

# Or compile and run
npm run build && npm start
```

### 4. Set Up Periodic Monitoring (Cron Job)
To run this every 15 minutes, you could add to your crontab:
```bash
*/15 * * * * cd /path/to/azure-devops-monitor && npm start >> monitor.log 2>&1
```

Or use Hermes' built-in cronjob tool for managed scheduling.

## Sample Output
```
Fetching work items (tasks) for project "aidapp"...

Found 704 task(s) in WIQL result. Fetching details...

=== Active Tasks (704) ===

Summary by state:
  Closed: 620
  New: 69
  Active: 15

---
ID: 5
  Title: HA: Learn Microsoft Tools (Teams, Loop, Azure DevOps) for Project Collaboration and Pull Requests
  State: Closed
  Assigned To: Sheza Aejaz
  Iteration Path: aidapp\Sprint 1
...
... and 684 more tasks.

Fetching wiki information...

No wikis found in the project.
```

## Next Steps
Would you like me to:
1. Set up a Hermes cron job to run this periodically and deliver results to Telegram?
2. Enhance the script to detect new/updated wiki pages (meeting notes)?
3. Add filtering for specific sprints or area paths?
4. Format the output as a summary report instead of raw task listing?