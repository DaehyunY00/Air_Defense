import { installIadsKernel } from './index.js';

const root = globalThis.window || globalThis;
root.KJ = root.KJ || {};
installIadsKernel(root.KJ);
root.KJ.iadsKernelReady = Promise.resolve(root.KJ.IADS);
