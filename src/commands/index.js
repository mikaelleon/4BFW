import fw from './fw.js';
import guide from './guide.js';
import announce from './announce.js';
import setup from './setup.js';
import mod from './mod.js';
import confessionId from './confession-id.js';
import appeal from './appeal.js';
import deleteOwn from './delete-own.js';
import filter from './filter.js';

export const commands = new Map([fw, guide, announce, setup, mod, confessionId, appeal, deleteOwn, filter].map((c) => [c.data.name, c]));
