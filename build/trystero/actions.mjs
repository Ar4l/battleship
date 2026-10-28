import { createActionWireManager } from './action-wire.mjs';

export const createActionManager = (options) => ({
  ...createActionWireManager(options),
  makeAction: () => {
    throw Error('Trystero actions are disabled in this build');
  },
});
