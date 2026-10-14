import { forward } from '../../_proxy.js';

export const onRequest = forward('status');
