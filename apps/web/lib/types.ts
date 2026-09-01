export type User = {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: string;
};

export type ModuleRow = {
  key: string;
  name: string;
  summary: string;
  alwaysOn: boolean;
  enabled: boolean;
  dependsOn: string[];
};

export type Tenant = { id: string; name: string; slug: string };

export type Status = {
  agentOnline: boolean | null;
  engineOnline: boolean | null;
  engineUrl: string | null;
  eventsToday: number;
  platesToday: number;
};
