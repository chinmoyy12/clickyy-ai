import { ToolRegistry } from './executor';
import { systemTools } from './system';
import { mediaTools } from './media';
import { appTools } from './apps';
import { webTools } from './web';
import { fileTools } from './files';
import { productivityTools } from './productivity';
import { skillTools } from './skills';
import { extraTools } from './extras';
import { officeTools } from './office';
import { controlTools } from './control';
import { appControlTools } from './appctl';
import { filePlusTools } from './filesplus';
import { organizerTools } from './organizer';
import { commsTools } from './comms';

export function createRegistry(): ToolRegistry {
  return new ToolRegistry().register(...systemTools, ...mediaTools, ...appTools, ...webTools, ...fileTools, ...productivityTools, ...skillTools, ...extraTools,
    ...officeTools, ...controlTools, ...appControlTools, ...filePlusTools, ...organizerTools, ...commsTools);
}
