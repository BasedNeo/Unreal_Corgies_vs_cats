// X4 lab captures: the project's dev config with HMR (and its full-page reloads) and file watching off, so edits by
// other lanes never restart a page mid-capture (a reloaded lab starts over in &hold). Restart the server after edits.
//   npx vite --config labs/ordnance.vite.config.mjs      (port 5303)   then   node labs/ordnance-shots.mjs
import { fileURLToPath } from 'node:url';
import base from '../vite.config.ts';

export default { ...base, root: fileURLToPath(new URL('..', import.meta.url)), server: { ...(base.server ?? {}), port: 5303, strictPort: true, hmr: false, watch: null } };
