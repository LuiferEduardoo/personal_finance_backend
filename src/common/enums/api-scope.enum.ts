import { registerEnumType } from '@nestjs/graphql';

// Permisos que se le pueden conceder a una API key. ALL concede todos los
// demás; el resto se otorgan uno a uno. Los valores llevan el formato
// "dominio:acción" porque es lo que se guarda en la base y se ve en logs.
export enum ApiScope {
  ALL = 'all',

  EXPENSES_READ = 'expenses:read',
  EXPENSES_WRITE = 'expenses:write',

  INCOMES_READ = 'incomes:read',
  INCOMES_WRITE = 'incomes:write',

  CATEGORIES_READ = 'categories:read',
  CATEGORIES_WRITE = 'categories:write',

  ACCOUNTS_READ = 'accounts:read',
  ACCOUNTS_WRITE = 'accounts:write',

  ARTICLES_READ = 'articles:read',
  ARTICLES_WRITE = 'articles:write',

  PRODUCTS_READ = 'products:read',
  PRODUCTS_WRITE = 'products:write',

  INVENTORY_READ = 'inventory:read',
  INVENTORY_WRITE = 'inventory:write',

  RECURRING_READ = 'recurring:read',
  RECURRING_WRITE = 'recurring:write',

  INFLATION_READ = 'inflation:read',

  INVOICES_WRITE = 'invoices:write',

  INVESTMENTS_READ = 'investments:read',
  INVESTMENTS_WRITE = 'investments:write',

  MARKET_DATA_READ = 'market-data:read',
}

registerEnumType(ApiScope, {
  name: 'ApiScope',
  description: 'Permiso que puede otorgarse a una API key',
});
