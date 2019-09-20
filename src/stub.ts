import { CmpStatus, DisplayStatus, PingReturn, WindowWithTCF } from '@mdnx/tcf-types';
import { isBoolean, isFunction, isString } from './utils';

const LOCATOR_NAME = '__tcfapiLocator';

export interface CreateTCFStubOptions {
  window: Window;
  onSuccess: () => {};
  onError: () => {};
}

export function createTCFStub(options: CreateTCFStubOptions) {
  const { window: windowFromOptions = window, onSuccess, onError } = options;
  const win = windowFromOptions as WindowWithTCF;
  const { document: doc } = win;

  const queue: any[] = [];
  let gdprApplies: boolean;

  const addFrame = (): boolean => {
    // check for other CMPs
    const otherCMP: boolean = !!((win.frames as any)[LOCATOR_NAME]);
    // There can be only one
    if (!otherCMP) {
      // check for body tag – otherwise we'll be be having a hard time appending a child to it if it doesn't exist
      if (doc.body) {
        const iframe = doc.createElement('iframe');
        iframe.style.cssText = 'display:none';
        iframe.name = LOCATOR_NAME;
        doc.body.appendChild(iframe);
      } else {
        // Wait for the body tag to exist. Since this API "stub" is located in the <head>, setTimeout allows us to inject the iframe more quickly than relying on DOMContentLoaded or other events.
        win.setTimeout(addFrame, 5);
      }
    }
    // if there was not another CMP then we have succeeded
    return !otherCMP;
  }

  const __tcfapi = (...args: any[]) => {
    // shortcut to get the queue when the full CMP implementation loads; it can call __tcfapi() with no arguments to get the queued arguments
    if (!args.length) {
      return queue;
    }

    switch (args[0]) {
      // shortcut to set gdprApplies if the publisher knows that they apply GDPR rules to all traffic
      case 'setGdprApplies':
        if (args.length > 3 && parseInt(args[1], 10) === 2 && isBoolean(args[3])) {
          gdprApplies = args[3];
          if (isFunction(args[2])) {
            args[2]('set', true);
          }
        }
        break;
      // Only supported method; give PingReturn object as response
      case 'ping':
        const pingReturn: PingReturn = {
          gdprApplies,
          cmpLoaded: false,
          apiVersion: '2.0',
          cmpStatus: CmpStatus.STUB,
          displayStatus: DisplayStatus.HIDDEN,
        };
        if (isFunction(args[2])) {
          args[2](pingReturn, true);
        }
        break;
      default:
        // some other method, just queue it for the full CMP implementation to deal with
        queue.push(args);
    }
  }

  const postMessageEventHandler = (event: MessageEvent) => {
    const msgIsString = isString(event.data);
    let json: any = {};
    // Try to parse the data from the event. This is important to have in a try/catch because often messages may come through that are not JSON
    try {
      json = msgIsString ? JSON.parse(event.data) : event.data;
    } catch (ignore) { }

    // the message we care about will have a payload
    const payload = json.__tcfapiCall;
    if (payload) {
      win.__tcfapi(
        payload.command,
        payload.parameter,
        payload.version,
        (retValue, success) => {
          const returnMsg = {
            __tcfapiReturn: {
              returnValue: retValue,
              success: success,
              callId: payload.callId,
            },
          };
          if (event.source instanceof Window) {
            event.source.postMessage(
              msgIsString ? JSON.stringify(returnMsg) : returnMsg,
              '*',
            );
          }
        });
    }
  }

  if (!isFunction(win.__tcfapi) && addFrame()) {
    win.__tcfapi = __tcfapi;
    win.addEventListener('message', postMessageEventHandler, false);
    onSuccess();
  } else {
    onError();
  }
}
