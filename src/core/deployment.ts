import type { DeploymentConfig } from './types';

const env = import.meta.env as Record<string, string | boolean | undefined>;

export const deploymentConfig: DeploymentConfig = {
  deploymentType: env.VITE_DEPLOYMENT_TYPE === 'DEDICATED' ? 'DEDICATED' : 'SAAS',
  ownerOrganizationId:
    typeof env.VITE_OWNER_ORGANIZATION_ID === 'string'
      ? env.VITE_OWNER_ORGANIZATION_ID
      : undefined,
  billingEnabled: env.VITE_BILLING_ENABLED !== 'false',
  multiTenantEnabled: env.VITE_MULTI_TENANT_ENABLED !== 'false',
  platformAdminEnabled: env.VITE_PLATFORM_ADMIN_ENABLED !== 'false',
};
