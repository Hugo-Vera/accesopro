export type User = {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: string;
  capabilities?: string[];
};

export type ModuleRow = {
  key: string;
  name: string;
  summary: string;
  alwaysOn: boolean;
  enabled: boolean;
  inPlan?: boolean;
  dependsOn: string[];
};

export type PlanLimits = {
  maxGuards: number;
  maxProperties: number;
  maxOwners: number;
};

export type PlanRow = {
  id: string;
  slug: string;
  name: string;
  summary: string;
  moduleKeys: string[];
  capabilityKeys: string[];
  limits: PlanLimits;
  sortOrder: number;
  assignedAt?: string | Date | null;
};

export type FeatureRow = {
  key: string;
  parentModule: string;
  name: string;
  summary: string;
  capabilityKey: string;
  href: string | null;
  defaultOn: boolean;
  sortOrder: number;
  parentOn: boolean;
  enabled: boolean;
};

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  planId?: string | null;
  planName?: string | null;
  planSlug?: string | null;
};

export type CamLaneStatus = {
  running: boolean;
  host: string;
  configured: boolean;
};

export type Status = {
  agentOnline: boolean | null;
  engineOnline: boolean | null;
  engineUrl: string | null;
  eventsToday: number;
  platesToday: number;
  cameraIn?: CamLaneStatus | null;
  cameraOut?: CamLaneStatus | null;
  evidenceIn?: boolean;
  evidenceOut?: boolean;
};
