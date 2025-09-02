import { gql } from 'graphql-tag';
import {
  CustomerService,
  PluginCommonModule,
  RequestContext,
  VendurePlugin,
} from '@vendure/core';

@VendurePlugin({
  imports: [PluginCommonModule],
  shopApiExtensions: {
    schema: gql`
      extend type Customer {
        groups: [CustomerGroup!]!
      }
    `,
    resolvers: {
      Customer: {
        groups: async (
          customer: { id: string },
          _args: unknown,
          context: { req: RequestContext; injector: any }
        ) => {
          const customerService = context.injector.get(CustomerService);
          return customerService.getCustomerGroups(context.req, customer.id);
        },
      },
    },
  },
})
export class CustomerGroupsShopPlugin {}
