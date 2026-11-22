import fw from './fw.js';
import guide from './guide.js';
import announce from './announce.js';
import setup from './setup.js';
import mod from './mod.js';
import confessionId from './confession-id.js';

export const commands = new Map([fw, guide, announce, setup, mod, confessionId].map((c) => [c.data.name, c]));
