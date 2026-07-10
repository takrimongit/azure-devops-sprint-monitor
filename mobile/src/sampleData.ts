// Sample sprint data modelled on the Helpables `aidapp` project.
// Dates are generated relative to "now" so the hygiene engine produces a
// live, realistic grade every time the app loads. Swap this module for a
// real Azure DevOps fetch (see README) to go from demo to production.

import { Sprint, Task } from './types';

const DAY = 1000 * 60 * 60 * 24;
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString();

let _id = 2100;
const nextId = () => ++_id;

interface Seed {
  title: string;
  state: 'New' | 'Active' | 'Closed' | 'Removed';
  lane: string;
  assignedTo: string;
  parentId: number | null;
  parentTitle: string | null;
  createdAgo: number;
  changedAgo: number;
}

const STORY_LEADGEN = 2050;
const STORY_CONTENT = 2051;
const STORY_PORTAL = 2052;

const seeds: Seed[] = [
  // Story: Lead-gen automation
  { title: 'Build missed-call text-back n8n workflow', state: 'Closed', lane: 'Completed', assignedTo: 'Sheza Aejaz', parentId: STORY_LEADGEN, parentTitle: 'Lead-gen automation rollout', createdAgo: 12, changedAgo: 2 },
  { title: 'Wire GHL webhook to CRM contact create', state: 'Active', lane: 'In Progress', assignedTo: 'Sheza Aejaz', parentId: STORY_LEADGEN, parentTitle: 'Lead-gen automation rollout', createdAgo: 12, changedAgo: 1 },
  { title: 'Fix bugs', state: 'Active', lane: 'In Progress', assignedTo: 'Sheza Aejaz', parentId: STORY_LEADGEN, parentTitle: 'Lead-gen automation rollout', createdAgo: 10, changedAgo: 6 },
  { title: 'Set up follow-up cadence (day 0 / 1 / 3)', state: 'New', lane: 'To do', assignedTo: 'Unassigned', parentId: STORY_LEADGEN, parentTitle: 'Lead-gen automation rollout', createdAgo: 9, changedAgo: 9 },

  // Story: Weekly content engine
  { title: 'Draft LinkedIn carousel on sprint automation', state: 'Closed', lane: 'Completed', assignedTo: 'Anam Khan', parentId: STORY_CONTENT, parentTitle: 'Weekly content engine', createdAgo: 11, changedAgo: 3 },
  { title: 'Record Loom walkthrough of HQ dashboard', state: 'Active', lane: 'In Progress', assignedTo: 'Anam Khan', parentId: STORY_CONTENT, parentTitle: 'Weekly content engine', createdAgo: 8, changedAgo: 7 },
  { title: 'WIP', state: 'New', lane: 'To do', assignedTo: 'Anam Khan', parentId: STORY_CONTENT, parentTitle: 'Weekly content engine', createdAgo: 8, changedAgo: 8 },
  { title: 'Publish case study: missed-call recovery', state: 'New', lane: 'To do', assignedTo: 'Anam Khan', parentId: STORY_CONTENT, parentTitle: 'Weekly content engine', createdAgo: 6, changedAgo: 6 },

  // Story: Client portal MVP
  { title: 'Design portal login + dashboard screens', state: 'Closed', lane: 'Completed', assignedTo: 'Bilal Raza', parentId: STORY_PORTAL, parentTitle: 'Client portal MVP', createdAgo: 13, changedAgo: 4 },
  { title: 'Implement headless CMS content models', state: 'Active', lane: 'In Progress', assignedTo: 'Bilal Raza', parentId: STORY_PORTAL, parentTitle: 'Client portal MVP', createdAgo: 12, changedAgo: 2 },
  { title: 'Add role-based access (clientId isolation)', state: 'New', lane: 'To do', assignedTo: 'Bilal Raza', parentId: STORY_PORTAL, parentTitle: 'Client portal MVP', createdAgo: 5, changedAgo: 5 },
  { title: 'TBD', state: 'New', lane: 'To do', assignedTo: 'Bilal Raza', parentId: STORY_PORTAL, parentTitle: 'Client portal MVP', createdAgo: 3, changedAgo: 3 },

  // Standalone
  { title: 'Update', state: 'New', lane: 'To do', assignedTo: 'Sheza Aejaz', parentId: null, parentTitle: null, createdAgo: 2, changedAgo: 2 },
];

const tasks: Task[] = seeds.map((s) => ({
  id: nextId(),
  title: s.title,
  state: s.state,
  lane: s.lane,
  assignedTo: s.assignedTo,
  iterationPath: 'aidapp\\Sprint 14',
  parentId: s.parentId,
  parentTitle: s.parentTitle,
  createdDate: ago(s.createdAgo),
  changedDate: ago(s.changedAgo),
}));

export const sampleSprint: Sprint = {
  name: 'aidapp\\Sprint 14',
  startDate: ago(13).split('T')[0],
  endDate: new Date(Date.now() + 1 * DAY).toISOString().split('T')[0],
  tasks,
};

export const projectName = 'aidapp';
export const orgName = 'HelpablesOrg';
