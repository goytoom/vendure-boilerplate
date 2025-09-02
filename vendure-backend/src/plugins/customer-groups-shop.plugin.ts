import { gql } from 'graphql-tag';
import {
  CustomerService,
  PluginCommonModule,
  RequestContext,
  Resolver,
  VendurePlugin,
} from '@vendure/core';
import { Customer } from '@vendure/core/dist/entity/customer/customer.entity';

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
          customer: Customer,
          _args: unknown,
          ctx: { req: RequestContext; injector: any }
        ) => {
          const customerService = ctx.injector.get(CustomerService);
          return customerService.getCustomerGroups(ctx.req, customer.id);
        },
      },
    },
  },
})
export class CustomerGroupsShopPlugin {}
