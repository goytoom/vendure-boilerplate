// src/app-injector.ts
import type { Injector } from '@vendure/core';

let _injector: Injector | undefined;

export function setAppInjector(injector: Injector) {
  _injector = injector;
}

export function getAppInjector(): Injector {
  if (!_injector) {
    throw new Error('Vendure Injector not initialized yet');
  }
  return _injector;
}
