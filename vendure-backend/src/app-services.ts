// src/app-services.ts
import type { CustomerService, ChannelService, CustomerGroupService } from '@vendure/core';

type Services = {
  customerService: CustomerService;
  channelService: ChannelService;
  customerGroupService: CustomerGroupService;
};

let services: Services | undefined;

export function setAppServices(s: Services) {
  services = s;
}

export function getAppServices(): Services {
  if (!services) {
    throw new Error('Vendure services not initialized yet');
  }
  return services;
}
