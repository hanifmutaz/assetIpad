export { CRED_FIELDS } from './policy.js';
import { getMaster } from './rules.js';
export const getMasterReasons = () => getMaster('reason');
