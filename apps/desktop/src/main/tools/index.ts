import { ToolRegistry } from './executor';
import { systemTools } from './system';
import { mediaTools } from './media';
import { appTools } from './apps';
import { webTools } from './web';
import { fileTools } from './files';
import { productivityTools } from './productivity';
import { skillTools } from './skills';
import { extraTools } from './extras';

export function createRegistry(): ToolRegistry {
  return new ToolRegistry().register(...systemTools, ...mediaTools, ...appTools, ...webTools, ...fileTools, ...productivityTools, ...skillTools, ...extraTools);
}
