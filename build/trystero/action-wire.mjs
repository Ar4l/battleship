import { decodeBytes, encodeBytes, toJson } from './utils.mjs';

/**
 * One frame per message: UTF-8 JSON `[type, data]` or `[type, data, metadata]`.
 * Messages that arrive before their handler is registered are queued.
 */
export const createActionWireManager = ({ getPeer, getPeerIds, canReceiveFromPeer }) => {
  const actions = new Map();
  const get = (type) => {
    let a = actions.get(type);
    if (!a) actions.set(type, (a = { options: {}, handler: null, queue: [] }));
    return a;
  };
  return {
    makeInternalAction: (type, options = {}) => {
      const a = get(type);
      a.options = options;
      return {
        onMessage: (f) => {
          a.handler = f;
          a.queue.splice(0).forEach((args) => f(...args));
        },
        onProgress: () => {},
        onReceive: () => {},
        onReject: () => {},
        send: async (data, targets, metadata) => {
          if (data === undefined) throw Error('action data cannot be undefined');
          const bytes = encodeBytes(toJson(metadata === undefined ? [type, data] : [type, data, metadata]));
          const pending = !!options.sendToPending;
          for (const id of new Set(targets ? [].concat(targets) : getPeerIds(pending))) {
            const peer = getPeer(id, pending);
            if (!peer) continue;
            try {
              peer.sendData(bytes);
            } catch {
              throw Object.assign(Error('peer disconnected'), { kind: 'disconnected' });
            }
          }
        },
      };
    },
    handleData: (peerId, data) => {
      let m;
      try {
        m = JSON.parse(decodeBytes(data));
      } catch {
        return;
      }
      const a = Array.isArray(m) && typeof m[0] === 'string' && actions.get(m[0]);
      if (!a || !canReceiveFromPeer(peerId, !!a.options.receiveWhilePending)) return;
      const args = [m[1], peerId, m[2]];
      if (a.handler) a.handler(...args);
      else a.queue.push(args);
    },
    clearPeer: () => {},
  };
};
