import { registerCommand } from '../bot/registry.js';
import { generalCommands } from './general.js';
import { toolCommands } from './tools.js';
import { mediaCommands } from './media.js';
import { groupCommands } from './group.js';
import { ownerCommands } from './owner.js';
import { scheduleCommands } from './schedule.js';
import { utilityCommands } from './utility.js';
const all = [
    ...generalCommands,
    ...toolCommands,
    ...mediaCommands,
    ...groupCommands,
    ...ownerCommands,
    ...scheduleCommands,
    ...utilityCommands,
];
export function registerAllCommands() {
    for (const command of all)
        registerCommand(command);
    return all.length;
}
//# sourceMappingURL=index.js.map