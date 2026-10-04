export type DeploymentType = 'SAAS' | 'DEDICATED';

export type OrganizationStatus = 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'INACTIVE';
export type MemberStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';

export type SystemRoleKey =
  | 'PLATFORM_OWNER'
  | 'SUPER_ADMIN'
  | 'ORGANIZATION_OWNER'
  | 'ADMIN'
  | 'MANAGER'
  | 'AGENT'
  | 'CLIENT'
  | 'OWNER_CLIENT'
  | 'ASSISTANT'
  | 'ACCOUNTING';

export type PermissionEffect = 'ALLOW' | 'DENY';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  legalName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  logoUrl?: string;
  status: OrganizationStatus;
  planId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  createdAt: string;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  status: MemberStatus;
  joinedAt?: string;
}

export interface Role {
  id: string;
  organizationId?: string;
  key?: SystemRoleKey;
  name: string;
  description?: string;
  isSystemRole: boolean;
  active: boolean;
}

export interface Permission {
  id: string;
  key: string;
  description?: string;
}

export interface MemberRole {
  organizationMemberId: string;
  roleId: string;
}

export interface MemberPermission {
  organizationMemberId: string;
  permissionId: string;
  effect: PermissionEffect;
}

export interface OrganizationBranding {
  organizationId: string;
  companyName: string;
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  website?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
}

export interface OrganizationSettings {
  organizationId: string;
  defaultCurrency: string;
  country: string;
  timezone: string;
  language: string;
  enableRentals: boolean;
  enableSales: boolean;
  enableProjects: boolean;
  enableAi: boolean;
  enableCommissions: boolean;
  enablePublicWebsite: boolean;
}

export interface DeploymentConfig {
  deploymentType: DeploymentType;
  ownerOrganizationId?: string;
  billingEnabled: boolean;
  multiTenantEnabled: boolean;
  platformAdminEnabled: boolean;
}
